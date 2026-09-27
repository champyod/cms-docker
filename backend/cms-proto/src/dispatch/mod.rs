//! The one gate a decoded message passes, in the order `rpc.py` passes it.
//!
//! `RemoteServiceBase.process_incoming_request` decides an incoming message in
//! six steps and writes its own answer at three points in the function, so a
//! handler that repeats the checks by hand is a handler that will eventually
//! repeat them in another order — and the order is the security property, not
//! an implementation detail. An unauthenticated caller is refused before the
//! method it named is read, so it learns nothing about which methods the
//! service has. The backdoor gate runs after authentication and before the
//! lookup, so a caller refused for it has already proven it knows the secret,
//! and a caller refused for any other reason is never told the backdoor is
//! there at all.
//!
//! Those six steps, which are not interchangeable:
//!
//! 1. the three required keys, and a message missing one is dropped unanswered;
//! 2. the secret, refused with the string `rpc.py` refuses with;
//! 3. the backdoor opt-in, for a method that opens a shell and a service that
//!    did not opt in, refused with that refusal even though the secret was right;
//! 4. the method name, refused as not existing when no entry in `methods` names it;
//! 5. that entry's [`Method::is_callable`], refused as not callable;
//! 6. the handler, and only then.
//!
//! Nothing after step 3 runs unless steps 1 to 3 passed, so an unauthenticated
//! or backdoor-refused caller cannot reach a handler and cannot tell an
//! existing name from one that is not.
//!
//! [`dispatch`] therefore performs the whole sequence in one place and reports
//! what the transport owes the wire: nothing at all for a message that cannot
//! be correlated, or one complete [`Response`] carrying either the refusal or
//! the result. Every refusal reuses the exact string `rpc.py` writes, so a
//! Python caller reads a Rust refusal as the refusal it would have read from a
//! Python service.
//!
//! The two halves are [`gate`], which reads a message and decides, and
//! [`answer`], which renders what that decision owes the wire.

mod answer;
mod gate;

pub use answer::{Decision, DropReason};
pub use gate::{dispatch, GateConfig, Method};
