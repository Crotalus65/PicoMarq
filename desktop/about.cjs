// Help > About PicoMarQ: what the box says and where its buttons lead.
// Kept free of Electron imports so it can be unit-tested.

const PICOMARQ_PAGE = 'https://github.com/Crotalus65/PicoMarq';
const SCRATCH_PAGE = 'https://github.com/erictli/scratch';

/** Options for the native message box. */
function aboutDialog(version) {
  return {
    type: 'info',
    title: 'About PicoMarQ',
    message: 'PicoMarQ',
    detail: [
      `Version ${version}`,
      '',
      'Based on Scratch by Eric Li and contributors.',
      '',
      `PicoMarQ: ${PICOMARQ_PAGE}`,
      `Scratch: ${SCRATCH_PAGE}`,
    ].join('\n'),
    buttons: ['PicoMarQ on GitHub', 'Scratch on GitHub', 'Close'],
    defaultId: 2,
    cancelId: 2,
    noLink: true,
  };
}

/** The page to open for the button that was pressed; none for Close. */
function aboutLink(response) {
  return [PICOMARQ_PAGE, SCRATCH_PAGE][response] || null;
}

module.exports = { aboutDialog, aboutLink, PICOMARQ_PAGE, SCRATCH_PAGE };
