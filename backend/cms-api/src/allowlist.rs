//! The three tiers, declared as deltas so no tier is a hand-copy of another.

use cms_db::{EffectivePermissions, WILDCARD_PERMISSION};

/// One `(service, method)` pair the wire names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rpc {
    service: &'static str,
    method: &'static str,
}

impl Rpc {
    /// The pair `service.method`.
    #[must_use]
    pub const fn new(service: &'static str, method: &'static str) -> Self {
        Self { service, method }
    }

    /// Whether this pair is the request's.
    #[must_use]
    pub fn is(&self, service: &str, method: &str) -> bool {
        self.service == service && self.method == method
    }
}

/// The tier a resolved set puts its holder in, narrowest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    /// Every enabled admin, whatever keys they hold.
    Authenticated,
    /// An admin holding a messaging capability.
    Messaging,
    /// An admin holding the wildcard.
    All,
}

impl Tier {
    /// The width of the tier, so one tier's list can be asked whether it covers another's.
    const fn rank(self) -> u8 {
        match self {
            Self::Authenticated => 0,
            Self::Messaging => 1,
            Self::All => 2,
        }
    }

    /// Whether this tier's list includes everything `needed` names.
    #[must_use]
    pub const fn covers(self, needed: Self) -> bool {
        self.rank() >= needed.rank()
    }
}

/// The five pairs every authenticated admin may call.
pub const RPCS_ALLOWED_FOR_AUTHENTICATED: &[Rpc] = &[
    Rpc::new("AdminWebServer", "submissions_status"),
    Rpc::new("ResourceService", "get_resources"),
    Rpc::new("EvaluationService", "workers_status"),
    Rpc::new("EvaluationService", "queue_status"),
    Rpc::new("LogService", "last_messages"),
];

/// What the messaging tier adds; the reference's own addition is empty on purpose.
pub const RPCS_ALLOWED_FOR_MESSAGING_ADDITIONS: &[Rpc] = &[];

/// The six service-control pairs only the wildcard tier may call.
pub const RPCS_ALLOWED_FOR_ALL_ADDITIONS: &[Rpc] = &[
    Rpc::new("ResourceService", "kill_service"),
    Rpc::new("ResourceService", "toggle_autorestart"),
    Rpc::new("EvaluationService", "enable_worker"),
    Rpc::new("EvaluationService", "disable_worker"),
    Rpc::new("EvaluationService", "invalidate_submission"),
    Rpc::new("ScoringService", "invalidate_submission"),
];

/// The key that grants the messaging tier.
const MESSAGE_SEND: &str = "message:send";

/// The key prefixes that grant the messaging tier.
const MESSAGING_PREFIXES: [&str; 2] = ["question:", "announcement:"];

/// Whether the tier's list admits this pair.
///
/// WHY one composition: each clause adds only its own tier's delta, so the three lists cannot drift apart.
#[must_use]
pub fn allows(tier: Tier, service: &str, method: &str) -> bool {
    holds(RPCS_ALLOWED_FOR_AUTHENTICATED, service, method)
        || (tier.covers(Tier::Messaging)
            && holds(RPCS_ALLOWED_FOR_MESSAGING_ADDITIONS, service, method))
        || (tier.covers(Tier::All) && holds(RPCS_ALLOWED_FOR_ALL_ADDITIONS, service, method))
}

/// The tier a resolved set puts its holder in.
///
/// WHY the widest is tested first: the order is the policy, and it stays spelled out even while the lists nest.
#[must_use]
pub fn tier_for(effective: &EffectivePermissions) -> Tier {
    // WHY membership: the resolver leaves the wildcard in the set beside the keys it expanded to.
    if effective.grants(WILDCARD_PERMISSION) {
        Tier::All
    } else if has_messaging(effective) {
        Tier::Messaging
    } else {
        Tier::Authenticated
    }
}

/// Whether the set names a messaging capability: the explicit key, or any question/announcement key.
#[must_use]
pub fn has_messaging(effective: &EffectivePermissions) -> bool {
    effective.grants(MESSAGE_SEND)
        || effective.keys().iter().any(|key| {
            MESSAGING_PREFIXES
                .iter()
                .any(|prefix| key.starts_with(prefix))
        })
}

/// Whether `list` holds the pair.
fn holds(list: &[Rpc], service: &str, method: &str) -> bool {
    list.iter().any(|rpc| rpc.is(service, method))
}
