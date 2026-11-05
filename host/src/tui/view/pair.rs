//! The pair-a-phone sheet.

use std::borrow::Cow;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use serde_json::Value;

use super::super::app::{App, PairCode};
use super::super::l10n::tr;
use super::super::md::{width as w, wrap};
use super::buffer::{centered, frame_box, put, put_line, u};
use super::style::theme;

pub(super) fn pair(buf: &mut Buffer, area: Rect, app: &App, code: &PairCode) {
    if let Some(request) = app.pairing_requests.first() {
        return ask(buf, area, request);
    }
    let t = theme();
    let (text, style) = match code {
        PairCode::Ready { url, short_code } => {
            return qr(buf, area, url, short_code.as_deref(), app.outside_account());
        }
        PairCode::Loading => ("Getting the pairing code…", t.secondary),
        PairCode::Failed(e) => (e.as_str(), t.red),
    };
    let r = centered(area, 56, 6);
    let inner = frame_box(buf, r, t.text, t.panel, Some(("Pair a device", t.text)));
    put(buf, inner.x, inner.y + 1, inner.width, text, style.patch(t.panel));
    if matches!(code, PairCode::Failed(_)) {
        put(buf, inner.x, inner.bottom() - 1, inner.width, "r try again · esc close", t.dim.patch(t.panel));
    }
}

/// A device that scanned the code waits for this computer: `y` lets it in. One that proved an account brings the
/// computer into it; one that proved none (the web client) is let in as a local device, and nothing joins. A
/// device that sent no check code is never asked to compare one.
fn ask(buf: &mut Buffer, area: Rect, request: &Value) {
    let t = theme();
    let name = request["deviceName"].as_str().unwrap_or("A device");
    let code = request["code"].as_str().unwrap_or_default();
    // A no-break space: the code never wraps apart.
    let code = match code.split_at_checked(3) {
        Some((a, b)) if code.len() == 6 => format!("{a}\u{a0}{b}"),
        _ => code.to_owned(),
    };
    // A request from before this field proved an account: only such a device was ever let in then.
    let certified = request["certified"].as_bool().unwrap_or(true);
    let email =
        request["email"].as_str().filter(|e| !e.is_empty()).map_or_else(|| tr("A Codync account"), Cow::Borrowed);
    // Two separate facts: what the device proved it joins, and whether there is a code to compare. The web client
    // sends none, and "Check the phone shows ." would ask the user to check nothing on a phone that isn't there.
    let line = match (certified, code.is_empty()) {
        (true, false) => {
            tr("{name} wants to use this computer. It joins {email}'s account. Check the phone shows {code}.")
                .replace("{email}", &email)
        }
        (false, false) => {
            tr("{name} wants to use this computer. It joins no account. Check the phone shows {code}.").into_owned()
        }
        (true, true) => {
            tr("{name} wants to use this computer. It joins {email}'s account. This device shows no check code.")
                .replace("{email}", &email)
        }
        (false, true) => {
            tr("{name} wants to use this computer. It joins no account. This device shows no check code.").into_owned()
        }
    };
    // The name last: whatever it says stays as written.
    let text = line.replace("{code}", &code).replace("{name}", name);
    let lines = note(text, 52, t.text.patch(t.panel));
    let r = centered(area, 56, u(lines.len() + 5));
    let inner = frame_box(buf, r, t.text, t.panel, Some(("Pair a device", t.text)));
    for (y, line) in (inner.y + 1..).zip(&lines) {
        put_line(buf, inner.x, y, inner.width, line);
    }
    put(buf, inner.x, inner.bottom() - 1, inner.width, "y let in · n don't allow", t.dim.patch(t.panel));
}

fn note(text: String, width: usize, style: Style) -> Vec<Line<'static>> {
    wrap(&[Span::styled(text, style)], width, &[], &[])
}

fn qr(buf: &mut Buffer, area: Rect, url: &str, short_code: Option<&str>, outside_account: bool) {
    let t = theme();
    let qr = qrcode::QrCode::new(url.as_bytes())
        .map(|c| c.render::<qrcode::render::unicode::Dense1x2>().quiet_zone(true).build())
        .unwrap_or_default();
    let lines: Vec<&str> = qr.lines().collect();
    let qw = lines.first().map_or(0, |l| w(l));
    // Under the QR, each in full: how to scan, the link, the code to type, and that the computer is in no account.
    let below = |width: usize| {
        let scan = if url.starts_with("codync-dev:") {
            "Scan with Codync Dev on your iPhone:"
        } else {
            "Scan with the Codync iPhone app, or open on the phone:"
        };
        let mut below = note(scan.to_owned(), width, t.secondary.patch(t.panel));
        below.extend(note(url.to_owned(), width, t.dim.patch(t.panel)));
        if let Some(code) = short_code {
            let text = tr("Or type this code in the app's pairing screen: {code}").replace("{code}", code);
            below.extend(note(text, width, t.text.patch(t.panel)));
        }
        if outside_account {
            let text =
                tr("Not in an account: a signed-in phone that scans this asks to bring the computer into its account.");
            below.extend(note(text.into_owned(), width, t.amber.patch(t.panel)));
        }
        below
    };
    let wide = below(qw.max(50));
    let fits = u(lines.len() + 4 + wide.len()) <= area.height && u(qw + 4) <= area.width;
    let (bw, qr_rows, below) = if fits { (u(qw.max(50) + 4), lines.len(), wide) } else { (70, 1, below(66)) };
    let r = centered(area, bw, u(qr_rows + 4 + below.len()));
    let inner = frame_box(buf, r, t.text, t.panel, Some(("Pair a device", t.text)));
    let mut y = inner.y;
    if fits {
        // The QR needs light modules on dark ones regardless of the terminal theme.
        let qs = Style::default().fg(Color::White).bg(Color::Black);
        let x = inner.x + inner.width.saturating_sub(u(qw)) / 2;
        for l in &lines {
            put(buf, x, y, u(qw), l, qs);
            y += 1;
        }
    } else {
        put(buf, inner.x, y, inner.width, "Make the window taller to show the QR code.", t.secondary.patch(t.panel));
        y += 1;
    }
    for (y, line) in (y..).zip(&below) {
        put_line(buf, inner.x, y, inner.width, line);
    }
    put(buf, inner.x, inner.bottom() - 1, inner.width, "r new code · esc close", t.dim.patch(t.panel));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn shown(buf: &Buffer) -> String {
        let a = buf.area;
        (a.top()..a.bottom())
            .map(|y| (a.left()..a.right()).map(|x| buf[(x, y)].symbol()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn a_waiting_phone_shows_its_account_the_code_and_the_keys() {
        let mut buf = Buffer::empty(Rect::new(0, 0, 80, 20));
        let request = json!({"requestId": "a", "deviceName": "Pixel", "email": "k@example.com", "code": "123456"});
        let area = buf.area;
        ask(&mut buf, area, &request);
        let text = shown(&buf);
        for part in ["Pixel", "k@example.com", "123\u{a0}456", "y let in · n don't allow"] {
            assert!(text.contains(part), "{part} in\n{text}");
        }
    }

    /// The lines the sheet wraps `text` into, so a copy assertion holds in any language and at any width.
    fn wrapped_lines(text: &str) -> Vec<String> {
        let t = theme();
        note(text.to_owned(), 52, t.text.patch(t.panel))
            .iter()
            .map(ToString::to_string)
            .filter(|l| !l.trim().is_empty())
            .collect()
    }

    /// A request from before the `certified` field proved an account, so it keeps the account sentence.
    #[test]
    fn a_request_without_the_flag_still_reads_as_the_account_it_proved() {
        let mut buf = Buffer::empty(Rect::new(0, 0, 80, 20));
        let request = json!({"requestId": "a", "deviceName": "Pixel", "email": "k@example.com", "code": "123456"});
        let area = buf.area;
        ask(&mut buf, area, &request);
        let text = shown(&buf);
        let expected =
            tr("{name} wants to use this computer. It joins {email}'s account. Check the phone shows {code}.")
                .replace("{name}", "Pixel")
                .replace("{email}", "k@example.com")
                .replace("{code}", "123\u{a0}456");
        for line in wrapped_lines(&expected) {
            assert!(text.contains(line.as_str()), "{line} in\n{text}");
        }
    }

    /// The web client proves no account: the sheet must not offer to join one, in any language.
    #[test]
    fn a_device_that_proved_no_account_is_offered_no_account() {
        let mut buf = Buffer::empty(Rect::new(0, 0, 80, 20));
        let request = json!({"requestId": "a", "deviceName": "Codync Web", "certified": false, "code": "123456"});
        let area = buf.area;
        ask(&mut buf, area, &request);
        let text = shown(&buf);
        let expected = tr("{name} wants to use this computer. It joins no account. Check the phone shows {code}.")
            .replace("{name}", "Codync Web")
            .replace("{code}", "123\u{a0}456");
        for line in wrapped_lines(&expected) {
            assert!(text.contains(line.as_str()), "{line} in\n{text}");
        }
        // Nothing joins, so nothing may name an account — least of all a missing one read as "account's account".
        assert!(!text.contains(&*tr("A Codync account")), "{text}");
        assert!(!text.contains("account's account"), "{text}");
    }

    /// A device that sent no code is asked to compare nothing, and no phone is named: it may be a browser.
    #[test]
    fn a_request_without_a_check_code_is_asked_to_compare_nothing() {
        for (request, expected) in [
            (
                json!({"requestId": "a", "deviceName": "Codync Web", "certified": false}),
                tr("{name} wants to use this computer. It joins no account. This device shows no check code.")
                    .replace("{name}", "Codync Web"),
            ),
            (
                json!({"requestId": "a", "deviceName": "Pixel", "email": "k@example.com"}),
                tr("{name} wants to use this computer. It joins {email}'s account. This device shows no check code.")
                    .replace("{name}", "Pixel")
                    .replace("{email}", "k@example.com"),
            ),
        ] {
            let mut buf = Buffer::empty(Rect::new(0, 0, 80, 20));
            let area = buf.area;
            ask(&mut buf, area, &request);
            let text = shown(&buf);
            for line in wrapped_lines(&expected) {
                assert!(text.contains(line.as_str()), "{line} in\n{text}");
            }
            assert!(
                !text.contains("phone") && !text.contains("{code}") && !text.contains("shows ."),
                "nothing to compare, so nothing may ask for it\n{text}"
            );
        }
    }

    #[test]
    fn a_computer_in_no_account_says_so_under_the_code() {
        let note =
            tr("Not in an account: a signed-in phone that scans this asks to bring the computer into its account.");
        // Its start, which fits on the first line in any language.
        let first: String = note.chars().take(6).collect();
        for (outside, says) in [(true, true), (false, false)] {
            let mut buf = Buffer::empty(Rect::new(0, 0, 100, 60));
            let area = buf.area;
            qr(&mut buf, area, "codync://pair?id=x&code=y", None, outside);
            assert_eq!(shown(&buf).contains(&first), says);
        }
    }

    #[test]
    fn the_whole_link_and_the_short_code_show() {
        let url = format!("codync://pair?v=3&id={}&code=end", "x".repeat(120));
        for height in [60, 12] {
            let mut buf = Buffer::empty(Rect::new(0, 0, 100, height));
            let area = buf.area;
            qr(&mut buf, area, &url, Some("QRTX-4821"), false);
            let text = shown(&buf);
            assert!(text.contains("code=end") && !text.contains('…'), "the link isn't cut short\n{text}");
            assert!(text.contains("QRTX-4821"), "{text}");
        }
    }
}
