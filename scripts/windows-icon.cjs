const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { NtExecutable, NtExecutableResource, Format } = require('pe-library');
const { Data, Resource } = require('resedit');
const digest = data => createHash('sha256').update(data ? Buffer.from(data) : Buffer.alloc(0)).digest('hex');
const otherResourceData = entries => entries.filter(entry => entry.type !== 3 && entry.type !== 14).map(({ type, id, lang, codepage, bin }) => ({ type, id, lang, codepage, hash: digest(bin) }));
const roundUp = (value, alignment) => Math.ceil(value / alignment) * alignment;

/**
 * Copy Electron's executable with the application's icon, name, and version
 * in place of Electron's own. The resource section is rebuilt; when the icon
 * is larger than Electron's it grows, and the sections that follow it (only
 * the relocation table) move up by a whole number of pages, with the data
 * directory that points at them updated. Code and data sections stay where
 * they were. Everything is verified by reading the result back.
 */
async function setWindowsIcon(inputPath, outputPath, iconPath, branding) {
  const original = await fs.readFile(inputPath);
  const exe = NtExecutable.from(original, { ignoreCert: true });
  const resources = NtExecutableResource.from(exe);
  const icon = Data.IconFile.from(await fs.readFile(iconPath));
  const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
  assert(groups.length > 0, 'The executable must have an existing icon group.');
  const originalOtherResources = otherResourceData(resources.entries);
  for (const group of groups) {
    Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icon.icons.map(item => item.data));
  }
  const versions = Resource.VersionInfo.fromEntries(resources.entries);
  assert(versions.length > 0, 'The executable must have version information.');
  for (const version of versions) {
    for (const language of version.getAllLanguagesForStringValues()) {
      version.setFileVersion(branding.version, language.lang);
      version.setProductVersion(branding.version, language.lang);
      version.setStringValues(language, {
        FileDescription: branding.productName,
        ProductName: branding.productName,
        InternalName: branding.productName,
        OriginalFilename: `${branding.productName}.exe`,
        FileVersion: branding.version,
        ProductVersion: branding.version,
      });
    }
    version.outputToResourceEntries(resources.entries);
  }
  const otherResources = otherResourceData(resources.entries);
  assert.deepEqual(otherResources.filter(entry => entry.type !== 16), originalOtherResources.filter(entry => entry.type !== 16));
  const resourceName = resources.sectionDataHeader.name;
  const originalExe = NtExecutable.from(original, { ignoreCert: true });
  const originalSections = originalExe.getAllSections();
  const originalResourceSection = originalExe.getSectionByEntry(Format.ImageDirectoryEntry.Resource);
  // Only the relocation table may sit after the resource section; anything
  // else (code, data) must not move.
  const movable = new Set(['.reloc']);
  for (const section of originalSections) {
    if (section.info.virtualAddress > originalResourceSection.info.virtualAddress) assert(movable.has(section.info.name), `Unexpected section after ${resourceName}: ${section.info.name}`);
  }
  // Rebuild the resource section in place when the icon fits in it, so every
  // address stays exactly where Electron put it; grow it only when the icon
  // is larger than Electron's own.
  const resourceSection = exe.getSectionByEntry(Format.ImageDirectoryEntry.Resource);
  try {
    const generated = resources.generateResourceData(resourceSection.info.virtualAddress, exe.getFileAlignment(), true, false);
    assert(generated.bin.byteLength <= resourceSection.info.sizeOfRawData);
    exe.setSectionByEntry(Format.ImageDirectoryEntry.Resource, { info: { ...resourceSection.info }, data: generated.bin });
  } catch (error) {
    if (!/larger than original/.test(String(error))) throw error;
    resources.outputResource(exe, false, false);
  }
  const output = Buffer.from(exe.generate());
  const verifiedExe = NtExecutable.from(output);
  const verifiedResources = NtExecutableResource.from(verifiedExe);
  assert.equal(verifiedExe.is32bit(), originalExe.is32bit());
  assert.equal(typeof originalExe.newHeader.optionalHeader.addressOfEntryPoint, 'number');
  assert.equal(verifiedExe.newHeader.optionalHeader.addressOfEntryPoint, originalExe.newHeader.optionalHeader.addressOfEntryPoint);
  const sectionAlignment = originalExe.newHeader.optionalHeader.sectionAlignment;
  const newResourceSection = verifiedExe.getSectionByEntry(Format.ImageDirectoryEntry.Resource);
  assert.equal(newResourceSection.info.virtualAddress, originalResourceSection.info.virtualAddress);
  const virtualShift = roundUp(newResourceSection.info.virtualSize, sectionAlignment) - roundUp(originalResourceSection.info.virtualSize, sectionAlignment);
  const rawShift = newResourceSection.info.sizeOfRawData - originalResourceSection.info.sizeOfRawData;
  assert(virtualShift >= 0 && rawShift >= 0);
  let lastEnd = 0;
  for (const section of originalSections) {
    const actual = verifiedExe.getAllSections().find(item => item.info.name === section.info.name);
    assert(actual, `Missing executable section: ${section.info.name}`);
    const after = section.info.virtualAddress > originalResourceSection.info.virtualAddress;
    assert.equal(actual.info.virtualAddress, section.info.virtualAddress + (after ? virtualShift : 0), `Section moved unexpectedly: ${section.info.name}`);
    assert.equal(actual.info.pointerToRawData, section.info.pointerToRawData + (after ? rawShift : 0), `Section file position changed unexpectedly: ${section.info.name}`);
    if (section.info.name !== resourceName) {
      assert.equal(actual.info.virtualSize, section.info.virtualSize);
      assert.equal(digest(actual.data), digest(section.data), `Changed executable section: ${section.info.name}`);
    }
    lastEnd = Math.max(lastEnd, roundUp(actual.info.virtualAddress + actual.info.virtualSize, sectionAlignment));
  }
  assert.equal(verifiedExe.newHeader.optionalHeader.sizeOfImage, lastEnd);
  // Every data directory still points at the section it pointed at before.
  for (let index = 0; index < 16; index++) {
    const before = originalExe.newHeader.optionalHeaderDataDirectory.get(index);
    const now = verifiedExe.newHeader.optionalHeaderDataDirectory.get(index);
    if (index === Format.ImageDirectoryEntry.Resource) {
      assert.equal(now.virtualAddress, before.virtualAddress);
      assert.equal(now.size, newResourceSection.info.virtualSize);
      continue;
    }
    const owner = originalSections.find(section => before.virtualAddress >= section.info.virtualAddress && before.virtualAddress < section.info.virtualAddress + roundUp(section.info.virtualSize, sectionAlignment));
    const shift = owner && owner.info.virtualAddress > originalResourceSection.info.virtualAddress ? virtualShift : 0;
    assert.equal(now.virtualAddress, before.virtualAddress + shift, `Data directory ${index} moved unexpectedly`);
    assert.equal(now.size, before.size, `Data directory ${index} changed size`);
  }
  assert.deepEqual(otherResourceData(verifiedResources.entries), otherResources);
  for (const version of Resource.VersionInfo.fromEntries(verifiedResources.entries)) {
    for (const language of version.getAllLanguagesForStringValues()) {
      const values = version.getStringValues(language);
      assert.equal(values.FileDescription, branding.productName);
      assert.equal(values.ProductName, branding.productName);
      assert.equal(values.OriginalFilename, `${branding.productName}.exe`);
      assert.equal(values.ProductVersion, branding.version);
    }
  }
  for (const group of Resource.IconGroupEntry.fromEntries(verifiedResources.entries)) {
    const actualIcons = group.getIconItemsFromEntries(verifiedResources.entries);
    assert.equal(actualIcons.length, icon.icons.length);
    actualIcons.forEach((actual, index) => {
      // Icon group dimensions encode 256 as zero.
      assert.equal(actual.width || 256, icon.icons[index].data.width || 256);
      assert.equal(actual.height || 256, icon.icons[index].data.height || 256);
      const expected = icon.icons[index].data;
      assert.equal(digest(actual.isRaw() ? actual.bin : actual.generate()), digest(expected.isRaw() ? expected.bin : expected.generate()), 'Embedded icon pixels do not match the app icon.');
    });
  }
  await fs.writeFile(outputPath, output);
  const grew = virtualShift ? `; the resource section grew by ${virtualShift} bytes and the relocation table moved after it` : '';
  console.log(`Embedded the ${branding.productName} name, version, and icon (${icon.icons.length} sizes); code, data, and other resources verified${grew}.`);
}
module.exports = { setWindowsIcon };
