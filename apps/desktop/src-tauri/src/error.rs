use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct PtyError {
    pub message: String,
}

impl std::fmt::Display for PtyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl From<std::io::Error> for PtyError {
    fn from(err: std::io::Error) -> Self {
        PtyError { message: err.to_string() }
    }
}
