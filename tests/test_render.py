"""Passages mode of the final video (worker/render.py): which frame ranges go
in, without video."""
from render import passages, span_of


def ev(frame, category="cyclists"):
    return {"frame": frame, "category": category}


def test_each_passage_gets_before_and_after():
    assert passages([ev(100), ev(500)], None, 30, 15, 15) == [(70, 115), (470, 515)]


def test_close_passages_become_one_cut():
    # 115 + join 15 reaches 130: one cut from the first start to the second end
    assert passages([ev(100), ev(160)], None, 30, 15, 15) == [(70, 175)]
    assert passages([ev(100), ev(161)], None, 30, 15, 15) == [(70, 115), (131, 176)]


def test_only_the_chosen_categories_cut_and_the_start_is_clipped():
    events = [ev(10), ev(300, "cars"), ev(600, "pedestrians")]
    assert passages(events, {"cyclists", "pedestrians"}, 30, 15, 15) == [(0, 25), (570, 615)]
    assert passages(events, {"mopeds"}, 30, 15, 15) == []


def test_span_of():
    spans = [(0, 25), (570, 615)]
    assert span_of(spans, 0) == (0, 25)
    assert span_of(spans, 25) == (0, 25)
    assert span_of(spans, 26) is None
    assert span_of(spans, 615) == (570, 615)
    assert span_of(spans, 700) is None
    assert span_of([], 3) is None
