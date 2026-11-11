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

#[cfg(windows)]
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
    use windows::Media::Ocr::OcrEngine;
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
    // The game's own language first, so Cyrillic or CJK lists are readable;
    // Latin recognizers also read the English names the game leaves untranslated.
    let mut missing_language = None;
    let mut engine = None;
    if let Some(code) = game_lang {
        let tag = ocr_tag(code);
        if let Ok(lang) = windows::Globalization::Language::CreateLanguage(&HSTRING::from(tag.as_str())) {
            if OcrEngine::IsLanguageSupported(&lang).unwrap_or(false) {
                engine = OcrEngine::TryCreateFromLanguage(&lang).ok();
            } else {
                missing_language = Some(tag);
            }
        }
    }
    let engine = match engine {
        Some(e) => e,
        None => OcrEngine::TryCreateFromUserProfileLanguages()?,
    };
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

#[cfg(not(windows))]
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
    fn maps_eft_language_codes() {
        assert_eq!(ocr_tag("jp"), "ja");
        assert_eq!(ocr_tag("ch"), "zh-Hans");
        assert_eq!(ocr_tag("ru"), "ru");
    }

    #[test]
    fn crop_is_anchored_right_on_ultrawide_and_not_upscaled_at_1440p() {
        let c = panel_crop(3440, 1440);
        assert_eq!(c.x + c.width, 3440);
        assert_eq!(c.width, 864);
        assert_eq!(c.scale, 1);
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
