use chrono::{DateTime, Datelike, FixedOffset, NaiveDate, NaiveDateTime, Utc, Weekday};

pub fn jakarta_offset() -> FixedOffset {
    FixedOffset::east_opt(7 * 3600).expect("valid +07:00 offset")
}

pub fn now_jakarta() -> DateTime<FixedOffset> {
    Utc::now().with_timezone(&jakarta_offset())
}

pub fn now_jakarta_naive() -> NaiveDateTime {
    now_jakarta().naive_local()
}

pub fn format_jakarta_dt(dt: NaiveDateTime) -> String {
    let offset = jakarta_offset();
    DateTime::<FixedOffset>::from_naive_utc_and_offset(dt - offset, offset).to_rfc3339()
}

pub fn format_opt_jakarta_dt(dt: Option<NaiveDateTime>) -> Option<String> {
    dt.map(format_jakarta_dt)
}

pub fn get_jakarta_date_string() -> String {
    now_jakarta().format("%Y-%m-%d").to_string()
}

pub fn naive_dt_to_jakarta_date_string(dt: NaiveDateTime) -> String {
    dt.format("%Y-%m-%d").to_string()
}

pub fn get_jakarta_month_year() -> (i32, i32) {
    let now = now_jakarta();
    (now.month() as i32, now.year())
}

pub fn get_iso_week_number() -> (i32, i32) {
    let now = now_jakarta();
    let iso = now.iso_week();
    (iso.week() as i32, iso.year())
}

#[allow(dead_code)]
pub fn is_tuesday() -> bool {
    now_jakarta().weekday() == Weekday::Tue
}

pub fn format_naive_date(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

pub fn format_idr(amount: i64) -> String {
    let neg = amount < 0;
    let s = amount.unsigned_abs().to_string();
    let mut out = String::new();
    for (idx, ch) in s.chars().rev().enumerate() {
        if idx > 0 && idx % 3 == 0 {
            out.push('.');
        }
        out.push(ch);
    }
    let formatted: String = out.chars().rev().collect();
    if neg {
        format!("-{}", formatted)
    } else {
        formatted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_idr_properly() {
        assert_eq!(format_idr(10000), "10.000");
        assert_eq!(format_idr(1500000), "1.500.000");
        assert_eq!(format_idr(0), "0");
        assert_eq!(format_idr(-25000), "-25.000");
    }
}
