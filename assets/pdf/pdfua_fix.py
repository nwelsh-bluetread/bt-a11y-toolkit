#!/usr/bin/env python3
"""Post-process a Chrome tagged PDF so it passes PDF/UA-1 (veraPDF ua1).

Usage: pdfua_fix.py <in.pdf> [extras.json]

Chrome's --export-tagged-pdf gets most of the way, but leaves:
  - painted backgrounds, borders, dots and aria-hidden text untagged (7.1-3)
  - no XMP metadata / dc:title / pdfuaid (7.1-8, 7.1-10)
  - link annotations without /Contents (7.18.1-2, 7.18.5-2)
  - PDF 2.0 tags such as Strong without a RoleMap entry (7.1-5)
  - list items with no LBody (7.2-20)
  - bookmark titles missing the space where a heading wrapped
Fixes them in place. extras.json is {links: {href: visible text}, headings: [heading text]}.
Requires pikepdf.
"""
import json
import sys

import pikepdf
from pikepdf import Name, Operator

PATH_BUILD = {'m', 'l', 'c', 'v', 'y', 'h', 're'}
PATH_PAINT = {'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*'}
PATH_END = PATH_PAINT | {'n'}
SHOW_TEXT = {'Tj', 'TJ', "'", '"'}
STANDALONE = {'Do', 'sh'}
# Non-standard (PDF 2.0 / HTML) structure types Chrome emits -> PDF 1.7 types.
ROLE_MAP = {'Strong': 'Span', 'Em': 'Span', 'Sub': 'Span', 'Title': 'H1', 'FENote': 'Note', 'Aside': 'Sect'}


def artifact(ops):
    return [([Name.Artifact], Operator('BMC')), *ops, ([], Operator('EMC'))]


def mark_untagged_as_artifacts(pdf):
    """Wrap graphics objects that sit outside any marked-content sequence in /Artifact BMC..EMC."""
    wrapped = 0
    for page in pdf.pages:
        out, path, depth = [], [], 0
        for inst in pikepdf.parse_content_stream(page):
            if isinstance(inst, pikepdf.ContentStreamInlineImage):
                if depth == 0:
                    out += artifact([inst]); wrapped += 1
                else:
                    out.append(inst)
                continue
            op = str(inst.operator)
            if op in ('BMC', 'BDC'):
                depth += 1
            elif op == 'EMC':
                depth -= 1
            if depth == 0 and (path or op in PATH_BUILD):
                path.append(inst)  # a path object: construction ops ... painting op
                if op in PATH_END:
                    if op in PATH_PAINT:
                        out += artifact(path); wrapped += 1
                    else:
                        out += path  # clipping path, nothing painted
                    path = []
                continue
            if depth == 0 and (op in SHOW_TEXT or op in STANDALONE):
                out += artifact([inst]); wrapped += 1
            else:
                out.append(inst)
        out += path
        page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(out))
    return wrapped


def fix_role_map(pdf):
    root = pdf.Root.get('/StructTreeRoot')
    if root is None:
        return
    used = set()

    def walk(node):
        if isinstance(node, pikepdf.Array):
            for k in node:
                walk(k)
        elif isinstance(node, pikepdf.Dictionary) and '/S' in node:
            used.add(str(node.S)[1:])
            walk(node.get('/K'))

    walk(root.get('/K'))
    needed = {k: v for k, v in ROLE_MAP.items() if k in used}
    if needed:
        rm = root.get('/RoleMap') or pikepdf.Dictionary()
        for k, v in needed.items():
            rm[Name('/' + k)] = Name('/' + v)
        root.RoleMap = rm


def wrap_list_bodies(pdf):
    """Chrome emits LI -> [Lbl], content...; PDF/UA wants LI -> [Lbl], LBody -> content."""
    root = pdf.Root.get('/StructTreeRoot')
    if root is None:
        return
    moved = {}  # LI objgen -> LBody, for re-pointing the ParentTree

    def walk(node):
        if isinstance(node, pikepdf.Array):
            for k in list(node):
                walk(k)
            return
        if not (isinstance(node, pikepdf.Dictionary) and '/S' in node):
            return
        if node.S == Name.LI:
            k = node.get('/K')
            kids = list(k) if isinstance(k, pikepdf.Array) else [] if k is None else [k]
            lbl = [x for x in kids if isinstance(x, pikepdf.Dictionary) and x.get('/S') == Name.Lbl]
            body = [x for x in kids if not (isinstance(x, pikepdf.Dictionary) and x.get('/S') in (Name.Lbl, Name.LBody))]
            if body:
                lbody = pdf.make_indirect(pikepdf.Dictionary(Type=Name.StructElem, S=Name.LBody, P=node, K=pikepdf.Array(body)))
                if '/Pg' in node:
                    lbody.Pg = node.Pg
                for x in body:
                    if isinstance(x, pikepdf.Dictionary) and '/S' in x:
                        x.P = lbody
                node.K = pikepdf.Array([*lbl, lbody])
                if node.is_indirect:
                    moved[node.objgen] = lbody
        walk(node.get('/K'))

    walk(root.get('/K'))
    # Marked content that sat directly in an LI now belongs to its LBody.
    nums = root.get('/ParentTree', {}).get('/Nums')
    for i in range(1, len(nums or []), 2):
        arr = nums[i]
        if isinstance(arr, pikepdf.Array):
            for j, el in enumerate(arr):
                if isinstance(el, pikepdf.Dictionary) and el.is_indirect and el.objgen in moved:
                    arr[j] = moved[el.objgen]
        elif isinstance(arr, pikepdf.Dictionary) and arr.is_indirect and arr.objgen in moved:
            nums[i] = moved[arr.objgen]


def fix_links(pdf, link_text):
    for page in pdf.pages:
        for annot in page.get('/Annots') or []:
            if annot.get('/Subtype') == Name.Link and '/Contents' not in annot:
                uri = str(annot.get('/A', {}).get('/URI', ''))
                text = link_text.get(uri)
                annot.Contents = pikepdf.String(f'{text} ({uri})' if text else f'Link to {uri}' if uri else 'Link')


def fix_outline(pdf, headings):
    # Chrome drops the space at a line wrap: "screen reader feedback" -> "screen readerfeedback".
    by_letters = {h.replace(' ', ''): h for h in headings}
    with pdf.open_outline() as outline:
        def walk(items):
            for item in items:
                real = by_letters.get(item.title.replace(' ', ''))
                if real and real != item.title:
                    item.title = real
                walk(item.children)
        walk(outline.root)


def fix_metadata(pdf):
    title = str(pdf.docinfo.get('/Title', '')) or 'Accessibility Audit Summary'
    with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
        meta['dc:title'] = title
        meta['pdfuaid:part'] = '1'
    pdf.Root.ViewerPreferences = pdf.Root.get('/ViewerPreferences') or pikepdf.Dictionary()
    pdf.Root.ViewerPreferences.DisplayDocTitle = True


def main():
    path = sys.argv[1]
    extras = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else {}
    pdf = pikepdf.open(path, allow_overwriting_input=True)
    n = mark_untagged_as_artifacts(pdf)
    fix_role_map(pdf)
    wrap_list_bodies(pdf)
    fix_links(pdf, extras.get('links', {}))
    fix_outline(pdf, extras.get('headings', []))
    fix_metadata(pdf)
    pdf.save(path, min_version='1.7')
    print(f'PDF/UA fixes applied ({n} decorative objects marked as artifacts)')


if __name__ == '__main__':
    main()
