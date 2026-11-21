mod gate;
mod logout;
mod page;
mod submit;

pub use gate::{client_address, gate};
pub use logout::logout;
pub use page::{page, LoginQuery};
pub use submit::submit;
