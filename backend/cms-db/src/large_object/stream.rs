//! The four stream operations a large object supports.
//!
//! Every one of them is a statement, and every one of them is refused with the
//! statement's name and the object's oid, which is what the reference's per-verb
//! `OSError` message carried.

use std::io::SeekFrom;

use super::{LargeObject, LargeObjectError};

const READ_SQL: &str = "SELECT loread($1, $2)";
const WRITE_SQL: &str = "SELECT lowrite($1, $2)";
const SEEK_SQL: &str = "SELECT lo_lseek($1, $2, $3)";
const TELL_SQL: &str = "SELECT lo_tell($1)";
const TRUNCATE_SQL: &str = "SELECT lo_truncate($1, $2)";

/// The `whence` numbers `lo_lseek` reads, which are the machine's own.
const SEEK_SET: i32 = 0;
const SEEK_CUR: i32 = 1;
const SEEK_END: i32 = 2;

impl LargeObject {
    /// Read into `buf`, returning how many bytes were read, zero at the end.
    ///
    /// A buffer longer than a statement can carry is read up to that limit rather
    /// than refused: the contract already allows a short read.
    ///
    /// # Errors
    ///
    /// [`LargeObjectError::Closed`] after [`close`](Self::close),
    /// [`LargeObjectError::NotReadable`] for a write-only object, and
    /// [`LargeObjectError::Read`] for whatever the server refused.
    pub async fn read(&mut self, buf: &mut [u8]) -> Result<usize, LargeObjectError> {
        let loid = self.loid();
        let descriptor = self.open_descriptor()?;
        if !self.mode().is_readable() {
            return Err(LargeObjectError::NotReadable { loid });
        }
        let length = buf.len().min(i32::MAX as usize);
        if length == 0 {
            return Ok(0);
        }
        let data: Vec<u8> = sqlx::query_scalar(READ_SQL)
            .bind(descriptor)
            .bind(length as i32)
            .fetch_one(self.connection())
            .await
            .map_err(|source| LargeObjectError::Read { loid, source })?;
        let read = data.len().min(buf.len());
        buf[..read].copy_from_slice(&data[..read]);
        Ok(read)
    }

    /// Write `bytes`, returning how many were stored.
    ///
    /// As with [`read`](Self::read), a buffer longer than a statement can carry is
    /// written up to that limit and the caller is told how much landed.
    ///
    /// # Errors
    ///
    /// [`LargeObjectError::Closed`] after [`close`](Self::close),
    /// [`LargeObjectError::NotWritable`] for a read-only object, and
    /// [`LargeObjectError::Write`] for whatever the server refused.
    pub async fn write(&mut self, bytes: &[u8]) -> Result<usize, LargeObjectError> {
        let loid = self.loid();
        let descriptor = self.open_descriptor()?;
        if !self.mode().is_writable() {
            return Err(LargeObjectError::NotWritable { loid });
        }
        let length = bytes.len().min(i32::MAX as usize);
        if length == 0 {
            return Ok(0);
        }
        let written: i32 = sqlx::query_scalar(WRITE_SQL)
            .bind(descriptor)
            .bind(&bytes[..length])
            .fetch_one(self.connection())
            .await
            .map_err(|source| LargeObjectError::Write { loid, source })?;
        // lowrite counts what it stored, so a negative count is the server breaking protocol.
        usize::try_from(written).map_err(|_| LargeObjectError::Write {
            loid,
            source: sqlx::Error::Protocol(format!("lowrite returned {written} bytes written")),
        })
    }

    /// Move the stream position, returning the new absolute one.
    ///
    /// # Errors
    ///
    /// [`LargeObjectError::Closed`] after [`close`](Self::close),
    /// [`LargeObjectError::PositionOutOfRange`] for an offset the statement cannot
    /// carry, and [`LargeObjectError::Seek`] for whatever the server refused.
    pub async fn seek(&mut self, position: SeekFrom) -> Result<u64, LargeObjectError> {
        let loid = self.loid();
        let descriptor = self.open_descriptor()?;
        let (offset, whence) = match position {
            SeekFrom::Start(offset) => (
                i64::try_from(offset).map_err(|_| LargeObjectError::PositionOutOfRange)?,
                SEEK_SET,
            ),
            SeekFrom::Current(offset) => (offset, SEEK_CUR),
            SeekFrom::End(offset) => (offset, SEEK_END),
        };
        let offset = i32::try_from(offset).map_err(|_| LargeObjectError::PositionOutOfRange)?;
        let reached: i32 = sqlx::query_scalar(SEEK_SQL)
            .bind(descriptor)
            .bind(offset)
            .bind(whence)
            .fetch_one(self.connection())
            .await
            .map_err(|source| LargeObjectError::Seek { loid, source })?;
        u64::try_from(reached).map_err(|_| LargeObjectError::PositionOutOfRange)
    }

    /// The stream's absolute position.
    ///
    /// # Errors
    ///
    /// [`LargeObjectError::Closed`] after [`close`](Self::close), and
    /// [`LargeObjectError::Tell`] for whatever the server refused.
    pub async fn tell(&mut self) -> Result<u64, LargeObjectError> {
        let loid = self.loid();
        let descriptor = self.open_descriptor()?;
        let position: i32 = sqlx::query_scalar(TELL_SQL)
            .bind(descriptor)
            .fetch_one(self.connection())
            .await
            .map_err(|source| LargeObjectError::Tell { loid, source })?;
        u64::try_from(position).map_err(|_| LargeObjectError::PositionOutOfRange)
    }

    /// Cut the object to `size`, or to the current position when it is `None`.
    ///
    /// # Errors
    ///
    /// [`LargeObjectError::Closed`] after [`close`](Self::close),
    /// [`LargeObjectError::NotWritable`] for a read-only object,
    /// [`LargeObjectError::PositionOutOfRange`] for a size the statement cannot
    /// carry, and [`LargeObjectError::Truncate`] for whatever the server refused.
    pub async fn truncate(&mut self, size: Option<u64>) -> Result<u64, LargeObjectError> {
        let loid = self.loid();
        let descriptor = self.open_descriptor()?;
        if !self.mode().is_writable() {
            return Err(LargeObjectError::NotWritable { loid });
        }
        let size = match size {
            Some(size) => size,
            None => self.tell().await?,
        };
        let parameter = i32::try_from(size).map_err(|_| LargeObjectError::PositionOutOfRange)?;
        sqlx::query(TRUNCATE_SQL)
            .bind(descriptor)
            .bind(parameter)
            .execute(self.connection())
            .await
            .map_err(|source| LargeObjectError::Truncate { loid, source })?;
        Ok(size)
    }

    /// The descriptor, or the error a closed object owes its caller.
    fn open_descriptor(&self) -> Result<i32, LargeObjectError> {
        self.descriptor
            .ok_or(LargeObjectError::Closed { loid: self.loid })
    }
}
