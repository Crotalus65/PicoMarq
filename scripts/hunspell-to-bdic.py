#!/usr/bin/env python3
"""Hunspell .aff/.dic -> Chromium .bdic dictionary converter (test tool).

PicoMarQ's spelling test (tests/spelling-smoke.cjs) needs a US English
dictionary in Chromium's .bdic format. Electron normally downloads it from
Google, which is not reachable everywhere tests run, so the test builds one
from the system's Hunspell en_US files (Debian/Ubuntu package hunspell-en-us).

This is a line-by-line Python port of Chromium's chrome/tools/convert_dict
(aff_reader.cc, dic_reader.cc, hunspell_reader.cc) and
third_party/hunspell/google/bdict_writer.cc.
Copyright 2011 The Chromium Authors. Use of the ported code is governed by
Chromium's BSD-style license.

Usage: python3 scripts/hunspell-to-bdic.py /usr/share/hunspell/en_US OUT.bdic
       (reads en_US.aff and en_US.dic)
"""
import hashlib
import struct
import sys

WS = b' \t\n\x0b\x0c\r'  # base::kWhitespaceASCII
sys.setrecursionlimit(10000)


def trim_line(line):
    if len(line) > 3 and line[:3] == b'\xef\xbb\xbf':
        line = line[3:]
    return line.strip(WS)


def read_lines(path):
    with open(path, 'rb') as handle:
        data = handle.read()
    for raw in data.split(b'\n'):
        nul = raw.find(b'\0')
        if nul >= 0:
            raw = raw[:nul]
        yield trim_line(raw)


def strip_comment(line):
    index = line.find(b'#')
    if index >= 0:
        return trim_line(line[:index])
    return line


def collapse_spaces(line):
    out = bytearray()
    previous_space = False
    for byte in line:
        if byte == 0x20:
            if previous_space:
                continue
            previous_space = True
        else:
            previous_space = False
        out.append(byte)
    return bytes(out)


class AffReader:
    def __init__(self, path):
        self.path = path
        self.encoding = 'ISO8859-1'
        self.has_indexed_affixes = False
        self.intro_comment = b''
        self.affix_groups = {}
        self.affix_rules = []
        self.replacements = []
        self.other_commands = []

    def to_utf8(self, encoded):
        return encoded.decode(self.encoding, errors='strict').encode('utf-8')

    def read(self):
        got_command = got_first_af = got_first_rep = False
        for line in read_lines(self.path):
            if not got_command and line[:1] == b'#':
                self.intro_comment += line + b'\n'
                continue
            line = strip_comment(line)
            if not line:
                continue
            got_command = True
            line = line.replace(b'\t', b' ')
            if line.startswith(b'SET '):
                self.encoding = trim_line(line[4:]).decode('ascii')
            elif line.startswith(b'AF '):
                self.has_indexed_affixes = True
                if got_first_af:
                    self.add_affix_group(line[3:])
                else:
                    got_first_af = True
            elif line.startswith(b'SFX ') or line.startswith(b'PFX '):
                self.add_affix(line)
            elif line.startswith(b'REP '):
                if got_first_rep:
                    self.add_replacement(line[4:])
                else:
                    got_first_rep = True
            elif line.startswith(b'TRY ') or line.startswith(b'MAP '):
                self.other_commands.append(self.to_utf8(line))
            elif line.startswith(b'IGNORE ') or line.startswith(b'COMPLEXPREFIXES '):
                raise SystemExit('Unsupported aff command: %r' % line)
            elif line.startswith(b'AM '):
                pass
            else:
                self.other_commands.append(line)

    def add_affix_group(self, rule):
        rule = trim_line(rule)
        affix_id = len(self.affix_groups) + 1
        self.affix_groups.setdefault(rule, affix_id)
        return affix_id

    def af_index(self, af_string):
        if af_string in self.affix_groups:
            return self.affix_groups[af_string]
        return self.add_affix_group(af_string)

    def get_affix_groups(self):
        max_id = max(self.affix_groups.values(), default=0)
        groups = [b''] * max_id
        for key, value in self.affix_groups.items():
            groups[value - 1] = b'AF ' + key
        return groups

    def add_affix(self, rule):
        rule = collapse_spaces(trim_line(rule))
        found_spaces = 0
        token = b''
        for i in range(len(rule)):
            if rule[i] == 0x20:
                found_spaces += 1
                if found_spaces == 3:
                    part_start = i
                    if token[:1] not in (b'Y', b'N'):
                        part_start = i - len(token)
                    part = rule[part_start:]
                    fields = part.split(b' ')
                    if len(fields) > 3:
                        part = b' '.join(fields[:3])
                    slash = part.find(b'/')
                    if slash >= 0 and not self.has_indexed_affixes:
                        before_flags = part[:slash + 1]
                        after = [piece.strip(WS) for piece in part[slash + 1:].split(b' ')]
                        if len(after) == 1:
                            after.append(b'.')
                        part = before_flags + str(self.af_index(after[0])).encode() + b' ' + after[1]
                    rule = rule[:part_start] + self.to_utf8(part)
                    break
                token = b''
            else:
                token += rule[i:i + 1]
        self.affix_rules.append(rule)

    def add_replacement(self, rule):
        rule = self.to_utf8(collapse_spaces(trim_line(rule)))
        space = rule.find(b' ')
        if space < 0:
            raise SystemExit('No space in replacement %r' % rule)
        self.replacements.append((rule[:space].replace(b'_', b' '), rule[space + 1:].replace(b'_', b' ')))


def split_dic_line(line):
    slash = len(line)
    for i in range(len(line)):
        if line[i] == 0x2F and i > 0 and line[i - 1] != 0x5C:
            slash = i
            break
    parts = [line[:slash].replace(b'\\/', b'/')]
    if slash < len(line) - 1:
        parts.append(line[slash + 1:])
    return parts


def read_dic(path, aff):
    words = {}
    first = True
    for line in read_lines(path):
        line = strip_comment(line)
        if not line:
            continue
        if first:
            first = False  # word count line
            continue
        parts = split_dic_line(line)
        word = parts[0] if aff.encoding == 'UTF-8' else aff.to_utf8(parts[0])
        affix_index = 0
        if len(parts) == 2:
            flags = parts[1]
            tab = flags.find(b'\t')
            if tab >= 0:
                flags = flags[:tab]
            affix_index = int(flags) if aff.has_indexed_affixes else aff.af_index(flags)
        tab = word.find(b'\t')
        if tab >= 0:
            word = word[:tab]
        words.setdefault(word, set()).add(affix_index)
    return sorted((word, sorted(affixes, reverse=True)) for word, affixes in words.items())


LEAF, LEAFMORE, LIST16, LIST8, LOOKUP32, LOOKUP16 = range(1, 7)


class Node:
    __slots__ = ('addition', 'children', 'leaf_addition', 'affix_indices', 'storage')

    def __init__(self):
        self.addition = 0
        self.children = []
        self.leaf_addition = b''
        self.affix_indices = []
        self.storage = 0


def nth_char_is(word, n, ch):
    if len(word) < n:
        return False
    return (word[n] if n < len(word) else 0) == ch


def build_trie(words, begin, end, depth, node):
    begin_str = words[begin][0]
    if len(begin_str) < depth:
        node.addition = 0
        node.affix_indices = words[begin][1]
        return begin + 1
    if depth == 0 and begin == 0:
        match_count = end - begin
        node.addition = 0
    else:
        match_count = 0
        node.addition = begin_str[depth - 1]
        while begin + match_count < end and nth_char_is(words[begin + match_count][0], depth - 1, node.addition):
            match_count += 1
    if match_count == 1:
        node.affix_indices = words[begin][1]
        node.leaf_addition = begin_str[depth:]
        return begin + 1
    i = begin
    while i < begin + match_count:
        child = Node()
        i = build_trie(words, i, begin + match_count, depth + 1, child)
        node.children.append(child)
    return begin + match_count


def lookup_details(children):
    if not children:
        return False, 0, 0
    first_offset = 0
    has_0th = False
    if children[0].addition == 0:
        has_0th = True
        first_offset = 1
    if len(children) == first_offset:
        return has_0th, 0, 0
    first = children[first_offset].addition
    last = children[-1].addition
    return has_0th, first, last - first + 1


def compute_storage(node):
    if not node.children:
        supplementary = 0
        if node.affix_indices[0] > 0x1FFE:
            supplementary = len(node.affix_indices) * 2 + 2
        elif len(node.affix_indices) > 1:
            supplementary = len(node.affix_indices) * 2
        if not node.leaf_addition:
            node.storage = LEAF
            return 2 + supplementary
        node.storage = LEAFMORE
        return 3 + len(node.leaf_addition) + supplementary
    child_size = sum(compute_storage(child) for child in node.children)
    count = len(node.children)
    if count < 16 and child_size <= 0xFF:
        node.storage = LIST8
        return 1 + count * 2 + child_size
    if count < 16 and child_size <= 0xFFFF:
        node.storage = LIST16
        return 1 + count * 3 + child_size
    has_0th, _first, table_count = lookup_details(node.children)
    if child_size + 2 + (2 if has_0th else 0) + table_count * 2 < 0xFFFF:
        node.storage = LOOKUP16
        return 2 + (2 if has_0th else 0) + table_count * 2 + child_size
    node.storage = LOOKUP32
    return 2 + (4 if has_0th else 0) + table_count * 4 + child_size


def serialize_leaf(node, out):
    first_affix = node.affix_indices[0] if node.affix_indices else 0
    first_in_supplementary = 1
    if first_affix > 0x1FFE:
        first_in_supplementary = 0
        first_affix = 0x1FFF
    id_byte = (first_affix >> 8) & 0x1F
    if node.storage == LEAFMORE:
        id_byte |= 0x40
    if len(node.affix_indices) > 1 or first_in_supplementary == 0:
        id_byte |= 0x20
    out.append(id_byte)
    out.append(first_affix & 0xFF)
    if node.storage == LEAFMORE:
        out += node.leaf_addition + b'\0'
    if len(node.affix_indices) > first_in_supplementary:
        for i in range(first_in_supplementary, min(len(node.affix_indices), 32)):
            value = node.affix_indices[i]
            out.append(value & 0xFF)
            out.append((value >> 8) & 0xFF)
        out += b'\xff\xff'


def serialize_list(node, out):
    is_8_bit = node.storage == LIST8
    out.append((0xE0 | (0 if is_8_bit else 0xF0) | len(node.children)) & 0xFF)
    per_entry = 2 if is_8_bit else 3
    table_begin = len(out)
    out += bytes(len(node.children) * per_entry)
    children_begin = len(out)
    for i, child in enumerate(node.children):
        out[table_begin + i * per_entry] = child.addition
        offset = len(out) - children_begin
        if is_8_bit:
            out[table_begin + i * per_entry + 1] = offset & 0xFF
        else:
            struct.pack_into('<H', out, table_begin + i * per_entry + 1, offset & 0xFFFF)
        serialize_trie(child, out)


def serialize_lookup(node, out):
    has_0th, first, table_count = lookup_details(node.children)
    is_32_bit = node.storage == LOOKUP32
    id_byte = 0xC0
    if is_32_bit:
        id_byte |= 0xC2
    if has_0th:
        id_byte |= 0xC1
    begin_offset = len(out)
    out += bytes([id_byte, first & 0xFF, table_count & 0xFF])
    per_entry = 4 if is_32_bit else 2
    zeroth = len(out)
    if has_0th:
        out += bytes(per_entry)
    table_begin = len(out)
    out += bytes(table_count * per_entry)
    for i, child in enumerate(node.children):
        if i == 0 and has_0th:
            where = zeroth
        else:
            where = table_begin + (child.addition - first) * per_entry
        if is_32_bit:
            struct.pack_into('<I', out, where, len(out))
        else:
            struct.pack_into('<H', out, where, (len(out) - begin_offset) & 0xFFFF)
        serialize_trie(child, out)


def serialize_trie(node, out):
    if node.storage in (LEAF, LEAFMORE):
        serialize_leaf(node, out)
    elif node.storage in (LIST8, LIST16):
        serialize_list(node, out)
    elif node.storage in (LOOKUP16, LOOKUP32):
        serialize_lookup(node, out)


def string_list(strings, out):
    for value in strings:
        out += value if value else b' '
        out.append(0)
    out.append(0)


def main(base, output):
    aff = AffReader(base + '.aff')
    aff.read()
    words = read_dic(base + '.dic', aff)
    root = Node()
    build_trie(words, 0, len(words), 0, root)

    out = bytearray(32)
    aff_offset = len(out)
    aff_header = len(out)
    out += bytes(16)
    out += b'\n' + aff.intro_comment + b'\n'
    groups = aff.get_affix_groups()
    group_offset = len(out)
    out += b'AF %d' % len(groups) + b'\0'
    string_list(groups, out)
    rule_offset = len(out)
    string_list(aff.affix_rules, out)
    rep_offset = len(out)
    for source, target in aff.replacements:
        out += source + b'\0' + target + b'\0'
    out.append(0)
    other_offset = len(out)
    string_list(aff.other_commands, out)
    struct.pack_into('<IIII', out, aff_header, group_offset, rule_offset, rep_offset, other_offset)

    dic_offset = len(out)
    compute_storage(root)
    serialize_trie(root, out)
    struct.pack_into('<IHHII', out, 0, 0x63694442, 2, 0, aff_offset, dic_offset)
    out[16:32] = hashlib.md5(bytes(out[aff_offset:])).digest()
    with open(output, 'wb') as handle:
        handle.write(out)
    print(f'{len(words)} words, {len(groups)} affix groups, {len(aff.affix_rules)} affix rules, '
          f'{len(aff.replacements)} replacements, {len(aff.other_commands)} other commands -> {output} ({len(out)} bytes)')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
