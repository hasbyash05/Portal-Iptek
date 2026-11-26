use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

#[derive(Debug)]
pub struct AppError {
    pub status: StatusCode,
    pub message: String,
    pub code: Option<String>,
    pub detail: Option<String>,
}

impl AppError {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
            code: None,
            detail: None,
        }
    }

    pub fn with_code(
        status: StatusCode,
        message: impl Into<String>,
        code: impl Into<String>,
    ) -> Self {
        Self {
            status,
            message: message.into(),
            code: Some(code.into()),
            detail: None,
        }
    }

    pub fn with_detail(
        status: StatusCode,
        message: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            status,
            message: message.into(),
            code: None,
            detail: Some(detail.into()),
        }
    }

    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, msg)
    }

    pub fn unauthorized(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, msg)
    }

    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::FORBIDDEN, msg)
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, msg)
    }

    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, msg)
    }

    pub fn internal(msg: impl Into<String>, err: impl ToString) -> Self {
        Self::with_detail(StatusCode::INTERNAL_SERVER_ERROR, msg, err.to_string())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let mut obj = serde_json::Map::new();
        obj.insert("status".to_string(), json!("error"));
        obj.insert("message".to_string(), json!(self.message));
        if let Some(code) = self.code {
            obj.insert("code".to_string(), json!(code));
        }
        if let Some(detail) = self.detail {
            obj.insert("error".to_string(), json!(detail));
        }
        (self.status, Json(Value::Object(obj))).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
