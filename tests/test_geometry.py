"""Worker geometry: line crossing and conversions between the processed frame
(analysis area, downscaled) and the original video."""
import pytest

from detect import box_in_original, crossing, ground_point, lines_in_frame
from reader import area_to_px

LINE = ((10, 0), (10, 20))  # vertical, x = 10


def test_crossing_in_the_middle_of_the_motion():
    assert crossing(*LINE, (5, 10), (15, 10)) == pytest.approx(0.5)
    assert crossing(*LINE, (8, 10), (18, 10)) == pytest.approx(0.2)


def test_no_crossing_on_the_same_side():
    assert crossing(*LINE, (1, 10), (9, 10)) is None


def test_no_crossing_beyond_the_segment_end():
    # passes x = 10, but below the end of the line (y > 20)
    assert crossing(*LINE, (5, 30), (15, 30)) is None


def test_no_crossing_when_starting_on_the_line():
    assert crossing(*LINE, (10, 10), (15, 10)) is None


def test_ground_point_is_the_bottom_center_of_the_box():
    assert ground_point((10, 20, 30, 60)) == (20, 60)


class TestAreaToPx:
    def test_no_area_is_the_whole_frame(self):
        assert area_to_px(None, 3840, 2160) is None

    def test_whole_frame_area_becomes_none(self):
        assert area_to_px((0, 0, 1, 1), 3840, 2160) is None

    def test_even_dimensions(self):
        # yuv420 needs even width, height and origin
        x, y, w, h = area_to_px((0.3556, 0.4455, 0.2003, 0.2167), 3840, 2160)
        assert all(v % 2 == 0 for v in (x, y, w, h))
        assert (x, y) == (1364, 962)
        assert 765 <= w <= 770 and 466 <= h <= 469

    def test_area_past_the_edge_is_clipped(self):
        x, y, w, h = area_to_px((0.8, 0.8, 0.5, 0.5), 1000, 1000)
        assert (x + w, y + h) == (1000, 1000)

    def test_area_too_small_is_ignored(self):
        assert area_to_px((0.5, 0.5, 0.01, 0.01), 1920, 1080) is None


class TestAreaCoordinates:
    META = {"area": [1000, 500, 800, 400], "original": [4000, 2000], "factor": 1.0}

    def test_lines_without_area_are_unchanged(self):
        lines = [{"id": "l", "x1": 0.1, "y1": 0.2, "x2": 0.3, "y2": 0.4}]
        assert lines_in_frame(lines, {"area": None}) is lines

    def test_lines_move_into_the_crop(self):
        # (0.25, 0.25) of the original = (1000, 500) px = crop corner
        # (0.45, 0.45) = (1800, 900) px = opposite corner
        [l] = lines_in_frame([{"id": "l", "name": "L", "x1": 0.25, "y1": 0.25, "x2": 0.45, "y2": 0.45}], self.META)
        assert (l["x1"], l["y1"]) == pytest.approx((0, 0))
        assert (l["x2"], l["y2"]) == pytest.approx((1, 1))
        assert l["name"] == "L"

    def test_box_goes_back_to_the_original(self):
        assert box_in_original([10, 20, 30, 40], self.META) == [1010, 520, 1030, 540]

    def test_box_of_a_downscaled_frame_goes_back_to_the_original(self):
        # 4K processed at 1080p: factor 2, no area
        assert box_in_original([10, 20, 30, 40], {"area": None, "factor": 2.0}) == [20, 40, 60, 80]
