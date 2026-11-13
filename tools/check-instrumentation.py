"""Require every release integration test to finish; startup crashes are failures."""
import pathlib
import sys
import xml.etree.ElementTree as ET

path = pathlib.Path(sys.argv[1])
output = path.read_text()
expected = {
    ("tv.lumen.app.ArtworkBridgeTest", "jpegArtworkReachesRealWebViewAndBadCacheRecovers"),
    ("tv.lumen.app.SourceRemoteTest", "dpadCenterAndMenuOpenTheSameSourceActions"),
    ("tv.lumen.app.TorrentEngineTest", "localPeerTorrentProducesSeekablePlayableVideoWithoutDebrid"),
    ("tv.lumen.app.VlcHandoffTest", "actualVlcPlaysDirectAndTrackerDiscoveredTorrentAndSurvivesEmptyActivityResult"),
}
fields, results = {}, {}
for line in output.splitlines():
    if line.startswith("INSTRUMENTATION_STATUS: "):
        key, _, value = line.removeprefix("INSTRUMENTATION_STATUS: ").partition("=")
        fields[key] = value
    elif line.startswith("INSTRUMENTATION_STATUS_CODE: "):
        code = int(line.split(":", 1)[1])
        if code != 1 and "class" in fields and "test" in fields:
            results[fields["class"], fields["test"]] = code
        fields = {}
suite = ET.Element("testsuite", name="release-integration", tests=str(len(results)), failures=str(sum(v != 0 for v in results.values())))
for (cls, name), code in results.items():
    case = ET.SubElement(suite, "testcase", classname=cls, name=name)
    if code != 0:
        ET.SubElement(case, "failure", message=f"Instrumentation status {code}")
ET.ElementTree(suite).write(path.with_suffix(".xml"), encoding="utf-8", xml_declaration=True)
assert expected.issubset(results), f"Missing or aborted release tests: {expected - results.keys()}"
assert all(results[k] == 0 for k in expected), f"Release integration test failed: {results}"
assert "OK (4 tests)" in output, "Instrumentation did not report a successful complete test run"
print("PASS: all four release tests completed, including actual VLC playback.")
