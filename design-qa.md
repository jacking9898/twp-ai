# Video subtitle controls and caption QA

Scope: the extension-owned control icon, popup, and translated caption line. The video image, original burned-in text, and Bilibili's own controls remain owned by the video/site. This is a component review, not a claim that the user's live subtitle data has been verified.

## Evidence

- Source captions: `C:/Users/jacking/AppData/Local/Temp/codex-clipboard-66bb5b36-bac1-441b-950a-03766d25eb53.png` (734 × 161 pixels).
- Source control: `C:/Users/jacking/AppData/Local/Temp/codex-clipboard-03cc7407-f7a4-4cd0-b654-abb6140926c9.png` (437 × 217 pixels).
- Browser-rendered implementation: `build/video-captions-preview.png`, `build/video-icon-preview.png` (1280 × 940 CSS/pixel viewport, deviceScaleFactor 1).
- Combined focused comparison: `.local-data/video-ui/design-comparison.png`. The 720-pixel fixture's caption region is enlarged 2× for comparison with the reference cropped from a larger player. This introduces raster antialiasing differences; it is not a pixel-exact density match.
- Full viewport screenshots were inspected before comparing the focused regions. The fixture uses deterministic source text and translation matching the reference wording; its original English is a fixture element representing text already present in the video. No production video or translation result is implied.

## Findings and iteration history

1. P1: the original implementation used a full-width black strip and repeated English. Changed to a transparent centered container with independent content-width caption lines and translation-only default. The final fixture contains one extension-owned Chinese line.
2. P2: captions could paint over the icon popup. Explicit stacking now puts settings and popup above the caption layer.
3. P2: immediately leaving native video fullscreen briefly retained the native cue renderer. The fullscreen event now renders synchronously; tests verify the DOM caption is visible and the native output track is hidden after exit.
4. P1 functional finding: disabling an output TextTrack before inspecting its cues prevented cleanup. Browser tests observed accumulation to 108 cues. Cleanup now exposes and removes cues before disabling, with a defensive clear before restart. After repeated restarts and imports, the one-cue fixture contains exactly one cue, including in native fullscreen.
5. Fixture-only encoding issue: explicitly declared UTF-8 to make the simulated native control labels readable.

## Fidelity surfaces

- Typography: white Arial / Microsoft YaHei captions, responsive font size, regular weight, readable line height. The source video's own English typography is preserved. Fixture enlargement causes expected raster differences.
- Spacing: centered text, individual small-radius backgrounds, bottom translation line, 32-pixel icon slot, two-row popup. No full-width opaque caption strip. Source subtitle position is outside extension control for burned-in text, so exact interline distance depends on the video.
- Colors: translucent dark caption/popup surfaces; existing Yedu orange switch/brand retained instead of copying the other extension's pink brand.
- Assets: existing Yedu icon is reused. The fixture background is intentionally a test player, not a recreation of the reference video imagery.
- Copy: icon opens “开启字幕翻译” and “字幕设置”; expert/model/glossary controls remain available. Same-language display explicitly says it did not call a translation service. Current cue details include source, translation and timestamps.

## Interaction verification

Real unpacked-extension browser regression covers icon hover/settings access, start/stop without navigation, translated/bilingual switching, fullscreen entry/exit, seeking, scope fields, cancellation, imports, export, and narrow settings. Page errors are asserted empty. Partial Bilibili track responses are merged with web-session results and downloaded tracks survive partial/empty responses. Same-language track identity is independently tested.

## Limits

The live user Chrome connection was unavailable. The actual 03:01 source cue and its translation have not been obtained, so the specific incorrect sentence's provenance remains unconfirmed. The in-app browser declined the local file preview; visual review instead used the real extension test's saved browser screenshots. No production-account access was bypassed.

No remaining P0/P1/P2 findings in the reviewed extension-owned components. Full live-video verification remains a separate integration gap.

final result: passed
