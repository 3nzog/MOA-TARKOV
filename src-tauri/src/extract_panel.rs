// Reads the extract list the game shows after O+O, from the screenshot the
// player takes with it open. Windows' own OCR (Windows.Media.Ocr) runs on the
// top-right corner of the image only; the text lines go to the front end, which
// matches them against the map's known extract and transit names.
//
// Passive: the screenshot is a file the game already writes. Nothing reads the
// game's memory or screen.
use std::path::Path;

/// Crop of the O+O panel, in source pixels, plus the upscale applied for OCR.
#[derive(Debug, PartialEq)]
pub struct PanelCrop {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub scale: u32,
}

/// The panel hangs from the top-right corner and the game UI scales with the
/// screen height, so the crop is measured in heights from the right edge. At
/// 1920x1080 it covers x 1272-1920, y 49-670 — the header, eight-plus rows and
/// the timer column.
pub fn panel_crop(w: u32, h: u32) -> PanelCrop {
    let width = ((h as f64 * 0.60).round() as u32).min(w);
    let y = (h as f64 * 0.045).round() as u32;
    let height = ((h as f64 * 0.62).round() as u32).saturating_sub(y).max(1);
    // Small text OCRs better upscaled; 1440p and up are large enough as is.
    let scale = if h >= 1400 { 1 } else { 2 };
    PanelCrop { x: w - width, y, width, height, scale }
}

/// EFT's Game.ini language code → a BCP-47 tag Windows OCR knows.
pub fn ocr_tag(eft: &str) -> String {
    match eft.to_ascii_lowercase().as_str() {
        "jp" => "ja".into(),
        // EFT writes Portuguese as "po" (Brazilian Portuguese in game).
        "po" => "pt-BR".into(),
        "ch" => "zh-Hans".into(),
        "kr" => "ko".into(),
        "ge" => "de".into(),
        "cz" => "cs".into(),
        "tu" => "tr".into(),
        "es-mx" => "es-MX".into(),
        other => other.into(),
    }
}

pub struct PanelText {
    pub lines: Vec<String>,
    /// The game's language when Windows has no OCR recognizer for it (the
    /// player can add it under Settings → Language), else None.
    pub missing_language: Option<String>,
}

#[cfg(all(windows, test))]
pub fn read_lines(path: &Path) -> windows::core::Result<Vec<String>> {
    read_panel(path, None).map(|p| p.lines)
}

/// OCR the panel with the recognizer for `game_lang` (EFT code) when Windows
/// has it, else the Windows display language's.
#[cfg(windows)]
pub fn read_panel(path: &Path, game_lang: Option<&str>) -> windows::core::Result<PanelText> {
    use windows::core::HSTRING;
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapBounds, BitmapDecoder, BitmapPixelFormat, BitmapTransform, ColorManagementMode,
        ExifOrientationMode,
    };
    use windows::Storage::{FileAccessMode, StorageFile};

    // The watcher thread is not a WinRT thread yet; a second call is harmless.
    unsafe {
        let _ = windows::Win32::System::WinRT::RoInitialize(windows::Win32::System::WinRT::RO_INIT_MULTITHREADED);
    }

    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.get()?;
    let stream = file.OpenAsync(FileAccessMode::Read)?.get()?;
    let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
    let (w, h) = (decoder.PixelWidth()?, decoder.PixelHeight()?);
    if w < 200 || h < 200 {
        return Ok(PanelText { lines: Vec::new(), missing_language: None });
    }
    let c = panel_crop(w, h);
    let transform = BitmapTransform::new()?;
    transform.SetScaledWidth(w * c.scale)?;
    transform.SetScaledHeight(h * c.scale)?;
    transform.SetBounds(BitmapBounds {
        X: c.x * c.scale,
        Y: c.y * c.scale,
        Width: c.width * c.scale,
        Height: c.height * c.scale,
    })?;
    let bitmap = decoder
        .GetSoftwareBitmapTransformedAsync(
            BitmapPixelFormat::Bgra8,
            BitmapAlphaMode::Premultiplied,
            &transform,
            ExifOrientationMode::IgnoreExifOrientation,
            ColorManagementMode::DoNotColorManage,
        )?
        .get()?;
    let (engine, missing_language) = pick_engine(game_lang)?;
    let result = engine.RecognizeAsync(&bitmap)?.get()?;
    let mut lines = Vec::new();
    for line in result.Lines()? {
        let text = line.Text()?.to_string();
        let text = text.trim();
        if !text.is_empty() && text.len() <= 120 {
            lines.push(text.to_owned());
        }
    }
    Ok(PanelText { lines, missing_language })
}

/// The OCR recognizer for the game's language when Windows has it (Cyrillic and
/// CJK need their own; Latin ones also read the English names the game leaves
/// untranslated), else the Windows display language's. Also returns the game's
/// language tag when Windows lacks it, so the player can be told.
#[cfg(windows)]
fn pick_engine(game_lang: Option<&str>) -> windows::core::Result<(windows::Media::Ocr::OcrEngine, Option<String>)> {
    use windows::core::HSTRING;
    use windows::Media::Ocr::OcrEngine;
    let mut missing_language = None;
    if let Some(code) = game_lang {
        let tag = ocr_tag(code);
        if let Ok(lang) = windows::Globalization::Language::CreateLanguage(&HSTRING::from(tag.as_str())) {
            if OcrEngine::IsLanguageSupported(&lang).unwrap_or(false) {
                if let Ok(e) = OcrEngine::TryCreateFromLanguage(&lang) {
                    return Ok((e, None));
                }
            } else {
                missing_language = Some(tag);
            }
        }
    }
    Ok((OcrEngine::TryCreateFromUserProfileLanguages()?, missing_language))
}

/// One word the OCR read, with its box in source-image pixels.
#[derive(serde::Serialize, Clone, Debug)]
pub struct ScreenWord {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct ScreenLine {
    pub text: String,
    pub words: Vec<ScreenWord>,
}

/// All the text on a screenshot, for the price check: the hovered item's
/// tooltip, or the short names on the inventory cells.
#[derive(serde::Serialize, Clone, Debug)]
pub struct ScreenText {
    pub width: u32,
    pub height: u32,
    pub lines: Vec<ScreenLine>,
    #[serde(rename = "missingLanguage")]
    pub missing_language: Option<String>,
}

/// Upscale for the whole screen: inventory short names are ~10 px tall at
/// 1080p (~13 at 1440p) and read far better doubled, as long as the engine
/// accepts the size. 4K text is big enough as is.
pub fn screen_scale(w: u32, h: u32, max_dim: u32) -> u32 {
    if h >= 2000 {
        return 1;
    }
    if w * 2 <= max_dim && h * 2 <= max_dim { 2 } else { 1 }
}

/// OCR the whole screenshot, keeping where every word sits.
#[cfg(windows)]
pub fn read_screen(path: &Path, game_lang: Option<&str>) -> windows::core::Result<ScreenText> {
    use windows::core::HSTRING;
    use windows::Graphics::Imaging::{
        BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, BitmapTransform, ColorManagementMode, ExifOrientationMode,
    };
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::{FileAccessMode, StorageFile};

    unsafe {
        let _ = windows::Win32::System::WinRT::RoInitialize(windows::Win32::System::WinRT::RO_INIT_MULTITHREADED);
    }
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.get()?;
    let stream = file.OpenAsync(FileAccessMode::Read)?.get()?;
    let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
    let (w, h) = (decoder.PixelWidth()?, decoder.PixelHeight()?);
    if w < 200 || h < 200 {
        return Ok(ScreenText { width: w, height: h, lines: Vec::new(), missing_language: None });
    }
    let max_dim = OcrEngine::MaxImageDimension().unwrap_or(4096);
    let scale = std::env::var("MOA_OCR_SCALE").ok().and_then(|v| v.parse().ok()).filter(|k: &u32| w * k <= max_dim && h * k <= max_dim).unwrap_or_else(|| screen_scale(w, h, max_dim));
    let transform = BitmapTransform::new()?;
    transform.SetScaledWidth(w * scale)?;
    transform.SetScaledHeight(h * scale)?;
    let bitmap = decoder
        .GetSoftwareBitmapTransformedAsync(
            BitmapPixelFormat::Bgra8,
            BitmapAlphaMode::Premultiplied,
            &transform,
            ExifOrientationMode::IgnoreExifOrientation,
            ColorManagementMode::DoNotColorManage,
        )?
        .get()?;
    let (engine, missing_language) = pick_engine(game_lang)?;
    let result = engine.RecognizeAsync(&bitmap)?.get()?;
    let k = scale as f32;
    let mut lines = Vec::new();
    for line in result.Lines()? {
        let text = line.Text()?.to_string().trim().to_owned();
        if text.is_empty() || text.len() > 160 {
            continue;
        }
        let mut words = Vec::new();
        for word in line.Words()? {
            let r = word.BoundingRect()?;
            words.push(ScreenWord { text: word.Text()?.to_string(), x: r.X / k, y: r.Y / k, w: r.Width / k, h: r.Height / k });
        }
        lines.push(ScreenLine { text, words });
    }
    Ok(ScreenText { width: w, height: h, lines, missing_language })
}

#[cfg(not(windows))]
pub fn read_screen(_path: &Path, _game_lang: Option<&str>) -> Result<ScreenText, String> {
    Ok(ScreenText { width: 0, height: 0, lines: Vec::new(), missing_language: None })
}

#[cfg(all(not(windows), test))]
pub fn read_lines(_path: &Path) -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

#[cfg(not(windows))]
pub fn read_panel(_path: &Path, _game_lang: Option<&str>) -> Result<PanelText, String> {
    Ok(PanelText { lines: Vec::new(), missing_language: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_covers_the_panel_at_1080p() {
        // Panel rows at 1080p start at x ~1345 and run from y ~60 to ~380.
        let c = panel_crop(1920, 1080);
        assert_eq!(c, PanelCrop { x: 1272, y: 49, width: 648, height: 621, scale: 2 });
    }

    #[test]
    fn doubles_1080p_for_the_screen_scan_only_when_the_engine_allows() {
        assert_eq!(screen_scale(1920, 1080, 10000), 2);
        assert_eq!(screen_scale(1920, 1080, 2600), 1);
        assert_eq!(screen_scale(2560, 1440, 10000), 2);
        assert_eq!(screen_scale(3840, 2160, 10000), 1);
    }

    #[test]
    fn maps_eft_language_codes() {
        assert_eq!(ocr_tag("jp"), "ja");
        assert_eq!(ocr_tag("ch"), "zh-Hans");
        assert_eq!(ocr_tag("ru"), "ru");
        assert_eq!(ocr_tag("po"), "pt-BR");
    }

    #[test]
    fn crop_is_anchored_right_on_ultrawide_and_not_upscaled_at_1440p() {
        let c = panel_crop(3440, 1440);
        assert_eq!(c.x + c.width, 3440);
        assert_eq!(c.width, 864);
        assert_eq!(c.scale, 1);
    }

    /// Whole-screen OCR on an image: cargo test screen_ -- --ignored --nocapture
    /// with MOA_OCR_SAMPLE set to a screenshot path.
    #[test]
    #[ignore]
    #[cfg(windows)]
    fn screen_reads_a_sample() {
        let Ok(p) = std::env::var("MOA_OCR_SAMPLE") else { return };
        let started = std::time::Instant::now();
        let t = read_screen(Path::new(&p), std::env::var("MOA_OCR_LANG").ok().as_deref()).expect("ocr");
        println!("{} ms, {}x{}", started.elapsed().as_millis(), t.width, t.height);
        if let Ok(out) = std::env::var("MOA_OCR_JSON") {
            std::fs::write(out, serde_json::to_string(&t).unwrap()).unwrap();
        }
        for l in t.lines {
            let first = l.words.first().map(|w| (w.x as i32, w.y as i32)).unwrap_or((0, 0));
            println!("| {:?} {}", first, l.text);
        }
    }

    /// Runs real OCR on an image: cargo test ocr_ -- --ignored --nocapture
    /// with MOA_OCR_SAMPLE set to a screenshot path.
    #[test]
    #[ignore]
    fn ocr_reads_a_sample() {
        let Ok(p) = std::env::var("MOA_OCR_SAMPLE") else { return };
        let started = std::time::Instant::now();
        let lines = read_lines(Path::new(&p)).expect("ocr");
        println!("{} ms", started.elapsed().as_millis());
        for l in lines {
            println!("| {l}");
        }
    }
}
