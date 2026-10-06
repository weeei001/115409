"""Plain-text helpers shared by API features and workers."""
from string import ascii_letters

_TAG_START = frozenset(ascii_letters + "/!?")


def strip_tags(text: str) -> str:
    """Remove HTML tags in one linear pass.

    A run of "<" directly before a tag is removed with it, so removal cannot join
    a kept "<" to a tag name. An unterminated tag runs to the end of the text.
    """
    kept, index = [], 0
    while (opener := text.find("<", index)) >= 0:
        kept.append(text[index:opener])
        name = opener
        while name < len(text) and text[name] == "<":
            name += 1
        if name < len(text) and text[name] in _TAG_START:
            close = text.find(">", name)
            index = len(text) if close < 0 else close + 1
        else:
            kept.append(text[opener:name])
            index = name
    kept.append(text[index:])
    return "".join(kept)
