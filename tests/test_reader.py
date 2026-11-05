"""worker/reader.py: ffmpeg's stderr must not block the frames on stdout."""
import subprocess
import sys

import reader  # noqa: E402  (worker/reader.py)

# what ffmpeg does on a damaged stretch of a DVR file: one error line per
# frame on stderr (far beyond the pipe buffer) before the rest of the frames
NOISY = ("import sys\n"
         "for i in range(20000): sys.stderr.write(f'[h264] error while decoding MB {i}\\n')\n"
         "sys.stderr.flush()\n"
         "sys.stdout.write('frames'); sys.stdout.flush()\n")


def test_stderr_full_of_errors_does_not_block_stdout():
    proc = subprocess.Popen([sys.executable, "-c", NOISY], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    tail = reader.StderrTail(proc.stderr, lines=3)
    try:
        assert proc.wait(timeout=30) == 0  # without draining, it hangs on stderr (TimeoutExpired)
        assert proc.stdout.read() == b"frames"
    finally:
        proc.kill()
    assert tail.text().splitlines() == [f"[h264] error while decoding MB {i}" for i in (19997, 19998, 19999)]
