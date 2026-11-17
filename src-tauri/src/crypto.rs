// 与设备 web 管理端 js/util.js 一致的哈希与短信编码
use sha2::{Digest, Sha256};

/// 固件 SHA256 输出为【大写十六进制】；内层结果原样（大写）参与外层拼接。
/// 用小写会导致登录被判为密码错误并消耗设备剩余尝试次数。
pub fn sha256_upper(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    let mut out = String::with_capacity(64);
    for b in digest {
        out.push_str(&format!("{:02X}", b));
    }
    out
}

pub fn login_password_hash(password: &str, ld: &str) -> String {
    sha256_upper(&format!("{}{}", sha256_upper(password), ld))
}

pub fn auth_ad(wa_inner_version: &str, cr_version: &str, rd: &str) -> String {
    sha256_upper(&format!(
        "{}{}",
        sha256_upper(&format!("{}{}", wa_inner_version, cr_version)),
        rd
    ))
}

/// UTF-16BE 十六进制（等价于 web 端 encodeMessage：BMP 4 位大写，非 BMP 输出完整码点）。
pub fn encode_sms_body(text: &str, lowercase: bool) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        let cp = ch as u32;
        let part = if cp <= 0xFFFF {
            format!("{:04X}", cp)
        } else {
            format!("{:X}", cp)
        };
        // 注意：不能在 if 表达式里借用 part.to_lowercase() 产生的临时值（E0716），
        // 拆成两条语句让临时 String 活到 push_str 调用结束。
        if lowercase {
            out.push_str(&part.to_lowercase());
        } else {
            out.push_str(&part);
        }
    }
    out
}

/// 短信时间 "YY;MM;DD;HH;MM;SS;+8"（与 web 端 getCurrentTimeString 一致）
pub fn sms_time_string() -> String {
    use chrono::{Datelike, Local, Timelike};
    let n = Local::now();
    let offset = n.offset().local_minus_utc() / 3600;
    let tz = if offset >= 0 {
        format!("+{}", offset)
    } else {
        format!("{}", offset)
    };
    format!(
        "{:02};{:02};{:02};{:02};{:02};{:02};{}",
        n.year() % 100,
        n.month(),
        n.day(),
        n.hour(),
        n.minute(),
        n.second(),
        tz
    )
}
