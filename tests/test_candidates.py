"""From the set of tracks to the review candidates (generate_candidates), the
splicing of broken tracks and the track persistence — all without video or
model, with hand-built trajectories on a 1000×1000 frame at 10 fps."""
from collections import Counter

import pytest

from detect import MIN_OBS, Track, generate_candidates, load_tracks, save_tracks, splice_tracks

FPS = 10.0
SIZE = 1000
LINE = {"id": "l1", "name": "Line 1", "x1": 0.5, "y1": 0.0, "x2": 0.5, "y2": 1.0}


def track(group, tid, xs, *, frame0=0, base=600, width=60, height=120, conf=0.8, **extra):
    """Track with the ground point at (x, base), one frame per position."""
    boxes = [(x - width / 2, base - height, x + width / 2, base) for x in xs]
    return Track(group, tid, frames=[frame0 + i for i in range(len(xs))], boxes=boxes,
                 conf_sum=conf * len(xs), **extra)


def generate(*tracks, lines=(LINE,), fine=False, scale=1.0):
    return generate_candidates({t.key: t for t in tracks}, list(lines), SIZE, SIZE, FPS, scale, fine=fine)


def moving(x0, x1, n=10):
    return [x0 + (x1 - x0) * i / (n - 1) for i in range(n)]


class TestCrossing:
    def test_a_crossing_car_becomes_one_candidate(self):
        [c] = generate(track("car", 1, moving(300, 700)))
        assert c["line_id"] == "l1"
        assert c["yolo_class"] == "cars"
        assert c["origin"] == "track"
        assert c["yolo_conf"] == pytest.approx(0.8)
        # x = 500 lies between the 5th (477.8) and the 6th (522.2) point
        assert c["frame"] in (4, 5)
        assert c["time_s"] == pytest.approx(c["frame"] / FPS)

    def test_opposite_directions(self):
        [there] = generate(track("car", 1, moving(300, 700)))
        [back] = generate(track("car", 1, moving(700, 300)))
        assert {there["direction"], back["direction"]} == {"A→B", "B→A"}

    def test_no_crossing_no_candidate(self):
        assert generate(track("car", 1, moving(100, 450))) == []

    def test_too_short_track_is_ignored(self):
        assert generate(track("car", 1, moving(300, 700, n=MIN_OBS - 1))) == []

    def test_one_candidate_per_track_and_line(self):
        # goes back and forth over the line: only the first crossing counts
        xs = moving(300, 700) + moving(700, 300)
        assert len(generate(track("ped", 1, xs))) == 1

    def test_two_lines_two_candidates(self):
        other = {**LINE, "id": "l2", "x1": 0.6, "x2": 0.6}
        cands = generate(track("car", 1, moving(300, 700)), lines=(LINE, other))
        assert sorted(c["line_id"] for c in cands) == ["l1", "l2"]

    def test_without_lines_counts_whoever_moves_enough(self):
        far = track("ped", 1, moving(100, 400))    # 300 px > 12% of the diagonal
        near = track("ped", 2, moving(100, 200))   # 100 px
        [c] = generate(far, near, lines=())
        assert c["track"] == "ped:1" and c["line_id"] is None and c["direction"] is None


class TestPersonOnVehicle:
    def cyclist(self, with_bicycle: bool):
        person = track("ped", 1, moving(300, 700), n_bike=10, neighbors=Counter({"bike:7": 10}))
        bike = track("bike", 7, moving(300, 700))
        return generate(person, bike) if with_bicycle else generate(person)

    def test_person_on_the_bicycle_drops_when_the_bicycle_crossed(self):
        [c] = self.cyclist(with_bicycle=True)
        assert c["track"] == "bike:7" and c["yolo_class"] == "cyclists"

    def test_without_the_bicycle_the_person_stays_as_a_cyclist(self):
        [c] = self.cyclist(with_bicycle=False)
        assert c["track"] == "ped:1"
        assert c["yolo_class"] == "cyclists"
        assert c["origin"] == "person_on_bicycle"

    def test_pedestrian_without_a_vehicle_stays_a_pedestrian(self):
        [c] = generate(track("ped", 1, moving(300, 700)))
        assert c["yolo_class"] == "pedestrians"

    def test_bicycle_and_motorcycle_on_the_same_object_become_one(self):
        bike = track("bike", 1, moving(300, 700, n=12))
        moto = track("moto", 2, moving(300, 700, n=8))
        [c] = generate(bike, moto)
        assert c["track"] == "bike:1"          # the longer track
        assert c["alternative"] == "motorcycles"

    def test_distant_bicycle_and_motorcycle_are_two_objects(self):
        bike = track("bike", 1, moving(300, 700))
        moto = track("moto", 2, moving(300, 700), frame0=100)
        assert len(generate(bike, moto)) == 2


class TestMotion:
    def test_a_moving_blob_becomes_an_other_candidate(self):
        [c] = generate(track("motion", 1, moving(300, 700), height=40, conf=0))
        assert c["origin"] == "motion" and c["yolo_class"] == "other"

    def test_a_too_short_blob_is_noise(self):
        # 0.4 s < MOTION_MIN_S
        assert generate(track("motion", 1, moving(300, 700, n=5), height=40)) == []

    def test_a_blob_that_moves_little_for_its_size_is_noise(self):
        # moved 60 px being 120 px tall (< 1.5 heights): a swaying leaf
        assert generate(track("motion", 1, moving(470, 530), height=120)) == []

    def test_a_blob_matching_a_yolo_event_is_the_same_object(self):
        car = track("car", 1, moving(300, 700))
        blob = track("motion", 2, moving(310, 710), height=40)
        [c] = generate(car, blob)
        assert c["track"] == "car:1"

    def test_inside_the_area_a_small_blob_is_noise(self):
        # 20×20 px: passes the regular filter, not the fine one (p90 area < 1000 px²)
        blob = track("motion", 1, moving(300, 700), width=20, height=20)
        assert len(generate(blob)) == 1
        assert generate(blob, fine=True) == []

    def test_inside_the_area_a_blob_that_moves_little_is_noise(self):
        blob = track("motion", 1, moving(450, 550), width=40, height=40)  # 100 px < 120
        assert len(generate(blob)) == 1
        assert generate(blob, fine=True) == []

    def test_inside_the_area_the_limits_follow_the_scale(self):
        # native-resolution 4K crop (scale 2): the same object has 2× the pixels
        blob = track("motion", 1, moving(400, 600), width=40, height=40)  # 200 px, 1600 px²
        assert len(generate(blob, fine=True, scale=1.0)) == 1
        assert generate(blob, fine=True, scale=2.0) == []


class TestLaneLine:
    """Short line that does not count cars (bike lane): the base of the box of
    a car in the next lane invades the lane and must not become a candidate."""
    BIKE_LANE = {"id": "bl", "x1": 0.5, "y1": 0.55, "x2": 0.5, "y2": 0.65, "categories": ["cyclists"]}

    def test_an_object_too_wide_for_the_lane_is_ignored(self):
        car = track("car", 1, moving(200, 800), width=400)
        assert generate(car, lines=(self.BIKE_LANE,)) == []

    def test_a_cyclist_in_the_lane_stays(self):
        cyclist = track("bike", 1, moving(300, 700), width=60)
        assert len(generate(cyclist, lines=(self.BIKE_LANE,))) == 1

    def test_a_line_that_counts_cars_accepts_wide_objects(self):
        street = {**self.BIKE_LANE, "categories": ["cars", "cyclists"]}
        car = track("car", 1, moving(200, 800), width=400)
        assert len(generate(car, lines=(street,))) == 1


class TestSplicing:
    def test_a_track_broken_on_the_line_is_spliced(self):
        # ByteTrack loses the car for 5 frames and picks it up with another id
        a = track("car", 1, moving(300, 480, n=10))            # 20 px/frame, frames 0–9
        b = track("car", 2, moving(600, 780, n=10), frame0=15)  # keeps the same pace
        tracks = splice_tracks({t.key: t for t in (a, b)}, FPS, 1.0)
        assert list(tracks) == ["car:1"]
        assert tracks["car:1"].n == 20
        assert tracks["car:1"].splices == ["car:1", "car:2"]
        # the crossing of x = 500 fell into the gap: only the spliced track sees it
        assert generate(a, b) == []
        assert len(generate(*tracks.values())) == 1

    def test_a_track_born_far_away_is_not_spliced(self):
        a = track("car", 1, moving(300, 480, n=10))
        b = track("car", 2, moving(600, 780, n=10), frame0=15, base=100)  # another lane
        assert len(splice_tracks({t.key: t for t in (a, b)}, FPS, 1.0)) == 2

    def test_different_groups_are_not_spliced(self):
        a = track("car", 1, moving(300, 480, n=10))
        b = track("ped", 2, moving(600, 780, n=10), frame0=15)
        assert len(splice_tracks({t.key: t for t in (a, b)}, FPS, 1.0)) == 2

    def test_person_neighbors_follow_the_splice(self):
        a = track("bike", 1, moving(300, 480, n=10))
        b = track("bike", 2, moving(600, 780, n=10), frame0=15)
        person = track("ped", 9, moving(300, 780, n=25), n_bike=25, neighbors=Counter({"bike:2": 5}))
        tracks = splice_tracks({t.key: t for t in (a, b, person)}, FPS, 1.0)
        assert tracks["ped:9"].neighbors == Counter({"bike:1": 5})


def test_saved_tracks_load_back_the_same(tmp_path):
    tr = track("ped", 3, moving(300, 700), n_bike=4, neighbors=Counter({"bike:1": 4}))
    tr.classes = Counter({0: 10})
    short = track("car", 4, moving(300, 700, n=MIN_OBS - 1))
    meta = {"fps": FPS, "version": 2}
    path = tmp_path / "tracks.json.gz"
    save_tracks(path, {t.key: t for t in (tr, short)}, meta)
    tracks, meta_read = load_tracks(path)
    assert meta_read == meta
    assert list(tracks) == ["ped:3"]  # the too-short one is not saved
    read = tracks["ped:3"]
    assert read.frames == tr.frames
    assert read.boxes == [tuple(round(v, 1) for v in c) for c in tr.boxes]
    assert read.classes == tr.classes and read.neighbors == tr.neighbors and read.n_bike == 4
    assert read.associated() == "bike"
