//! The declaration a model states, and the errors it can hold.
//!
//! The reference applied these rules while it built each mapper; here they run
//! when a model module's declaration is checked, because a Rust model is a struct
//! and this is the part of the base the struct cannot express.

use cms_db::{ArrayItem, Column, ColumnKind, Declaration, DeclarationError};

const SUBMISSION: Declaration = Declaration {
    table: "submissions",
    columns: &[
        Column {
            name: "id",
            kind: ColumnKind::Integer,
            nullable: false,
            has_default: true,
            primary_key: true,
            foreign_key: false,
        },
        Column {
            name: "user_id",
            kind: ColumnKind::Integer,
            nullable: false,
            has_default: false,
            primary_key: false,
            foreign_key: true,
        },
        Column {
            name: "task_id",
            kind: ColumnKind::Integer,
            nullable: false,
            has_default: false,
            primary_key: false,
            foreign_key: true,
        },
        Column {
            name: "timestamp",
            kind: ColumnKind::Timestamp,
            nullable: false,
            has_default: false,
            primary_key: false,
            foreign_key: false,
        },
        Column {
            name: "language",
            kind: ColumnKind::Text,
            nullable: false,
            has_default: false,
            primary_key: false,
            foreign_key: false,
        },
        Column {
            name: "comment",
            kind: ColumnKind::Text,
            nullable: true,
            has_default: false,
            primary_key: false,
            foreign_key: false,
        },
    ],
    relationships: &["user", "task"],
};

const fn column(name: &'static str) -> Column {
    Column {
        name,
        kind: ColumnKind::Text,
        nullable: false,
        has_default: false,
        primary_key: false,
        foreign_key: false,
    }
}

const LANGUAGE: Column = column("language");
const TASK_ID: Column = column("task_id");
const UNNAMED: Column = column("");
const LANGUAGE_TWICE: &[Column] = &[column("language"), column("language")];

#[test]
fn every_kind_names_the_rust_type_its_field_must_have() {
    let kinds = [
        ColumnKind::Boolean,
        ColumnKind::Integer,
        ColumnKind::BigInteger,
        ColumnKind::Oid,
        ColumnKind::Float,
        ColumnKind::Enum,
        ColumnKind::Text,
        ColumnKind::Digest,
        ColumnKind::Timestamp,
        ColumnKind::Interval,
        ColumnKind::Array(ArrayItem::Text),
        ColumnKind::Array(ArrayItem::Integer),
        ColumnKind::Cidr,
        ColumnKind::Jsonb,
    ];
    for kind in kinds {
        assert!(!kind.rust_type().is_empty(), "{kind:?} names no type");
    }
    assert_eq!(
        ColumnKind::Array(ArrayItem::Text).rust_type(),
        "Vec<String>"
    );
    assert_eq!(
        ColumnKind::Array(ArrayItem::Integer).rust_type(),
        "Vec<i32>"
    );
    assert_eq!(ColumnKind::Digest.rust_type(), "FileDigest");
}

#[test]
fn the_carried_set_skips_every_key_and_keeps_the_order() {
    let names: Vec<&str> = SUBMISSION
        .value_columns()
        .map(|column| column.name)
        .collect();
    assert_eq!(names, ["timestamp", "language", "comment"]);
}

#[test]
fn a_column_is_required_only_when_it_is_neither_nullable_nor_self_filling() {
    let carried: Vec<(&str, bool)> = SUBMISSION
        .value_columns()
        .map(|column| (column.name, column.is_required()))
        .collect();
    assert_eq!(
        carried,
        [("timestamp", true), ("language", true), ("comment", false)]
    );
    assert!(SUBMISSION.columns[0].has_default);
    assert!(!SUBMISSION.columns[0].is_carried());
}

#[test]
fn a_complete_declaration_validates() {
    assert_eq!(SUBMISSION.validate(), Ok(()));
}

#[test]
fn an_unnamed_part_is_refused() {
    assert_eq!(
        Declaration {
            table: "",
            ..SUBMISSION
        }
        .validate(),
        Err(DeclarationError::Unnamed {
            table: "",
            kind: "table",
        })
    );
    assert_eq!(
        Declaration {
            columns: &[UNNAMED],
            relationships: &[],
            ..SUBMISSION
        }
        .validate(),
        Err(DeclarationError::Unnamed {
            table: "submissions",
            kind: "column",
        })
    );
    assert_eq!(
        Declaration {
            columns: &[LANGUAGE],
            relationships: &[""],
            ..SUBMISSION
        }
        .validate(),
        Err(DeclarationError::Unnamed {
            table: "submissions",
            kind: "relationship",
        })
    );
}

#[test]
fn a_column_declared_twice_is_refused() {
    assert_eq!(
        Declaration {
            columns: LANGUAGE_TWICE,
            relationships: &[],
            ..SUBMISSION
        }
        .validate(),
        Err(DeclarationError::DuplicateColumn {
            table: "submissions",
            name: "language",
        })
    );
}

#[test]
fn a_relationship_named_like_a_column_is_refused() {
    assert_eq!(
        Declaration {
            columns: &[TASK_ID],
            relationships: &["task_id"],
            ..SUBMISSION
        }
        .validate(),
        Err(DeclarationError::RelationshipNamesColumn {
            table: "submissions",
            name: "task_id",
        })
    );
}

#[test]
fn a_relationship_declared_twice_is_refused() {
    assert_eq!(
        Declaration {
            columns: &[],
            relationships: &["files", "files"],
            ..SUBMISSION
        }
        .validate(),
        Err(DeclarationError::DuplicateRelationship {
            table: "submissions",
            name: "files",
        })
    );
}
