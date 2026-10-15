//! Pasting an image (a screenshot on the clipboard) into a pane: it is saved as a PNG
//! in the temp folder and its path typed, for Claude Code and other tools that read
//! images from a path.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Pasted images are kept this long, then removed on a later paste.
const KEEP: Duration = Duration::from_secs(7 * 24 * 60 * 60);

pub fn images_dir() -> PathBuf {
    std::env::temp_dir().join("qterm-images")
}

/// Writes RGBA pixels as a new PNG in `dir`; returns its path. Older pasted images go.
pub fn save_png(dir: &Path, rgba: &[u8], width: u32, height: u32) -> Result<PathBuf, String> {
    if width == 0 || height == 0 || rgba.len() != (width as usize) * (height as usize) * 4 {
        return Err("the clipboard's image is empty or malformed".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    remove_old(dir);
    let stamp = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = dir.join(format!("pasted-{stamp}.png"));
    let file = std::fs::File::create(&path).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .and_then(|mut writer| writer.write_image_data(rgba))
        .map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(path)
}

fn remove_old(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let old = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > KEEP);
        if old && entry.path().extension().is_some_and(|ext| ext == "png") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_the_pixels_as_a_png() {
        let dir = std::env::temp_dir().join(format!("qterm-paste-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        // 2x1: a red and a half-transparent green pixel.
        let path = save_png(&dir, &[255, 0, 0, 255, 0, 255, 0, 128], 2, 1).unwrap();
        let decoder = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(&path).unwrap()));
        let mut reader = decoder.read_info().unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut pixels).unwrap();
        assert_eq!(pixels, [255, 0, 0, 255, 0, 255, 0, 128]);
        assert!(save_png(&dir, &[1, 2, 3], 2, 1).is_err(), "too few bytes for the size");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
