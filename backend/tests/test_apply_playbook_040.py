"""Spec 040: Claude clicks the exact box before typing (a Workday Skills box
moves down as skills are added; typing once landed in a Job Title)."""

from app.services.apply_playbook import APPLY_PLAYBOOK_VERSION, playbook_text


def test_the_playbook_says_click_the_box_before_typing():
    text = playbook_text()
    assert APPLY_PLAYBOOK_VERSION >= "2026.12.07"
    assert "click the exact box and check it has the focus" in text
    assert "type one item, pick it from the list, then click the box again" in text
