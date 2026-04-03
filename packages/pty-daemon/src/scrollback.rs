pub struct ScrollbackBuffer {
    cap: usize,
    buf: Vec<u8>,
}

impl ScrollbackBuffer {
    pub fn new(cap: usize) -> Self {
        Self { cap, buf: Vec::with_capacity(cap) }
    }

    /// Append data, draining from the front if total would exceed cap.
    pub fn push(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        let total = self.buf.len() + data.len();
        if total > self.cap {
            let drain = total - self.cap;
            // If new data alone exceeds cap, discard the buffer entirely and
            // keep only the tail of `data`.
            if drain >= self.buf.len() {
                self.buf.clear();
                let tail_start = data.len().saturating_sub(self.cap);
                self.buf.extend_from_slice(&data[tail_start..]);
            } else {
                self.buf.drain(0..drain);
                self.buf.extend_from_slice(data);
            }
        } else {
            self.buf.extend_from_slice(data);
        }
    }

    pub fn get(&self) -> &[u8] {
        &self.buf
    }

    pub fn len(&self) -> usize {
        self.buf.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_buffer_returns_empty_slice() {
        let buf = ScrollbackBuffer::new(100);
        assert_eq!(buf.get(), &[] as &[u8]);
        assert_eq!(buf.len(), 0);
        assert!(buf.is_empty());
    }

    #[test]
    fn push_within_cap_is_byte_identical() {
        let mut buf = ScrollbackBuffer::new(100);
        let data = b"hello world";
        buf.push(data);
        assert_eq!(buf.get(), data);
        assert_eq!(buf.len(), data.len());
    }

    #[test]
    fn push_exactly_at_cap_no_drain() {
        let mut buf = ScrollbackBuffer::new(10);
        buf.push(b"1234567890");
        assert_eq!(buf.len(), 10);
        assert_eq!(buf.get(), b"1234567890");
    }

    #[test]
    fn push_over_cap_drops_front_keeps_tail() {
        let mut buf = ScrollbackBuffer::new(10);
        buf.push(b"ABCDE");
        buf.push(b"12345678"); // total = 13, drain 3 from front
        assert_eq!(buf.len(), 10);
        assert_eq!(buf.get(), b"DE12345678");
    }

    #[test]
    fn multi_push_cumulative_overflow_never_exceeds_cap() {
        let cap = 50;
        let mut buf = ScrollbackBuffer::new(cap);
        for i in 0u8..100 {
            buf.push(&[i; 3]);
            assert!(buf.len() <= cap, "len {} exceeded cap {}", buf.len(), cap);
        }
        // Last 50 bytes should be the tail of the pushes (bytes 50..100 in groups of 3)
        assert_eq!(buf.len(), cap);
    }

    #[test]
    fn large_single_chunk_over_cap_keeps_tail_only() {
        let mut buf = ScrollbackBuffer::new(10);
        let data: Vec<u8> = (0u8..=99).collect(); // 100 bytes
        buf.push(&data);
        assert_eq!(buf.len(), 10);
        assert_eq!(buf.get(), &data[90..]); // last 10 bytes
    }

    #[test]
    fn push_empty_slice_is_noop() {
        let mut buf = ScrollbackBuffer::new(10);
        buf.push(b"hello");
        buf.push(b"");
        assert_eq!(buf.get(), b"hello");
    }
}
