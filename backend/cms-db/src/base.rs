//! The declaration every model carries, and the four things this port dropped.
//!
//! The reference's declarative base reflects over a mapper: it splits properties
//! into columns and relationships, types the constructor from the column types,
//! and hands each instance its session. A port has no mapper, so the parts that
//! dissolve are named here rather than rebuilt:
//!
//! - `sa_mapper`, `sa_session`, `sa_primary_key` and `sa_identity_key` — a model
//!   is a struct, so its identity is its fields and there is no registry to ask;
//! - `get_from_id` — a session query, which belongs with the query layer;
//! - `clone`, `get_attrs` and `set_attrs` — a struct literal is the constructor
//!   and `Clone` is the copy, with the field's type performing the runtime check
//!   `set_attrs` made;
//! - `__init__`'s refusals — the same substitution: a wrong value does not build.
//!
//! What survives is the classification `__declare_last__` performed and the type
//! map behind it: a model declares its table, its columns with the Rust type each
//! holds, and its relationships; [`Declaration::value_columns`] is the set the
//! reference's attribute helpers copied, which never includes a key. A model
//! module states one of these beside its struct, and [`Declaration::validate`]
//! refuses the declaration errors a typo produces.

/// The kind of value a column holds.
///
/// `Unicode`, `String`, `Codename`, `Filename` and `FilenameSchema` collapse into one arm because all five hold `String`; the domain rule stays in `types`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColumnKind {
    /// `boolean`, held as `bool`.
    Boolean,
    /// `integer`, held as `i32`.
    Integer,
    /// `bigint`, held as `i64`.
    BigInteger,
    /// `oid`, held as `u32`.
    Oid,
    /// `double precision`, held as `f64`.
    Float,
    /// A PostgreSQL enum, held as the enum its variants name.
    Enum,
    /// `text` and `varchar`, held as `String`.
    Text,
    /// The `DIGEST` domain, held as [`FileDigest`](crate::FileDigest).
    Digest,
    /// `timestamp`, held as the zone-less UTC spelling of [`make_timestamp`](crate::make_timestamp).
    Timestamp,
    /// `interval`, held as [`Interval`](crate::Interval).
    Interval,
    /// An array, held as a `Vec` of its item.
    Array(ArrayItem),
    /// `cidr`, held as text: a network has no `std` type, and the column is read
    /// where its query binds it.
    Cidr,
    /// `jsonb`, carried as the text the statement casts, as the score columns are.
    Jsonb,
}

/// The item type of an array column.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArrayItem {
    /// A text item, held as `String`.
    Text,
    /// An integer item, held as `i32`.
    Integer,
}

impl ColumnKind {
    /// The Rust type a field for this column must have.
    #[must_use]
    pub const fn rust_type(self) -> &'static str {
        match self {
            Self::Boolean => "bool",
            Self::Integer => "i32",
            Self::BigInteger => "i64",
            Self::Oid => "u32",
            Self::Float => "f64",
            Self::Enum => "the enum its variants name",
            Self::Text => "String",
            Self::Digest => "FileDigest",
            Self::Timestamp => "NaiveDateTime",
            Self::Interval => "Interval",
            Self::Array(ArrayItem::Text) => "Vec<String>",
            Self::Array(ArrayItem::Integer) => "Vec<i32>",
            Self::Cidr => "String",
            Self::Jsonb => "String",
        }
    }
}

/// One column of a model, as the model declares it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Column {
    /// The column's name in the table.
    pub name: &'static str,
    /// The value it holds.
    pub kind: ColumnKind,
    /// Whether the column accepts NULL.
    pub nullable: bool,
    /// Whether the column fills itself when an insert leaves it out.
    pub has_default: bool,
    /// Whether the column is part of the primary key.
    pub primary_key: bool,
    /// Whether the column is part of a foreign key.
    pub foreign_key: bool,
}

impl Column {
    /// Whether the model's attribute set carries this column.
    ///
    /// WHY keys are excluded: the reference skipped them so a clone and an attribute dump described values without identity.
    #[must_use]
    pub const fn is_carried(&self) -> bool {
        !self.primary_key && !self.foreign_key
    }

    /// Whether the column must be given a value: neither nullable nor self-filling.
    #[must_use]
    pub const fn is_required(&self) -> bool {
        !self.nullable && !self.has_default
    }
}

/// A model's table, its columns, and its relationships.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Declaration {
    /// The table the model maps onto.
    pub table: &'static str,
    /// Every column, in declaration order.
    pub columns: &'static [Column],
    /// The names of the relationships the model carries, which are not columns.
    pub relationships: &'static [&'static str],
}

impl Declaration {
    /// The columns the attribute set carries, in declaration order.
    pub fn value_columns(&self) -> impl Iterator<Item = &Column> {
        self.columns.iter().filter(|column| column.is_carried())
    }

    /// Refuse a declaration whose names cannot describe a table.
    pub fn validate(&self) -> Result<(), DeclarationError> {
        if self.table.is_empty() {
            return Err(DeclarationError::Unnamed {
                table: self.table,
                kind: "table",
            });
        }
        for (index, column) in self.columns.iter().enumerate() {
            if column.name.is_empty() {
                return Err(DeclarationError::Unnamed {
                    table: self.table,
                    kind: "column",
                });
            }
            if self.columns[..index]
                .iter()
                .any(|seen| seen.name == column.name)
            {
                return Err(DeclarationError::DuplicateColumn {
                    table: self.table,
                    name: column.name,
                });
            }
            if self.relationships.contains(&column.name) {
                return Err(DeclarationError::RelationshipNamesColumn {
                    table: self.table,
                    name: column.name,
                });
            }
        }
        for (index, relationship) in self.relationships.iter().enumerate() {
            if relationship.is_empty() {
                return Err(DeclarationError::Unnamed {
                    table: self.table,
                    kind: "relationship",
                });
            }
            if self.relationships[..index].contains(relationship) {
                return Err(DeclarationError::DuplicateRelationship {
                    table: self.table,
                    name: relationship,
                });
            }
        }
        Ok(())
    }
}

/// Why a declaration cannot describe a table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum DeclarationError {
    /// A table, column or relationship was declared with no name.
    #[error("{table:?}: a {kind} was declared with no name")]
    Unnamed {
        /// The table being declared.
        table: &'static str,
        /// Which part of it is unnamed.
        kind: &'static str,
    },
    /// Two columns share a name, so a query could not tell them apart.
    #[error("{table:?}: column {name:?} is declared twice")]
    DuplicateColumn {
        /// The table being declared.
        table: &'static str,
        /// The name that repeats.
        name: &'static str,
    },
    /// A relationship shares a column's name.
    #[error("{table:?}: relationship {name:?} is also a column")]
    RelationshipNamesColumn {
        /// The table being declared.
        table: &'static str,
        /// The name that repeats.
        name: &'static str,
    },
    /// Two relationships share a name.
    #[error("{table:?}: relationship {name:?} is declared twice")]
    DuplicateRelationship {
        /// The table being declared.
        table: &'static str,
        /// The name that repeats.
        name: &'static str,
    },
}
