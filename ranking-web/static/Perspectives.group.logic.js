/* Pure team-grouping helpers for the group perspective. */

(function (root, factory) {
    var logic = typeof module === "object" && module.exports
        ? require("./Perspectives.logic.js")
        : root.PerspectivesLogic;
    var api = factory(logic);
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    } else {
        root.PerspectivesGroupLogic = api;
    }
}(typeof self !== "undefined" ? self : this, function (PerspectivesLogic) {
    function sortMembers(members, scoreOf) {
        return members.slice().sort(function (left, right) {
            return scoreOf(right) - scoreOf(left);
        });
    }

    /* One row per grouping key: the summed value, the members behind it and a
       competition rank, so a team row can expand to the users it was built from. */
    function aggregateByGroup(entries, keyOf, valueOf, scoreOf, nameOf) {
        var groups = PerspectivesLogic.sumBy(entries, keyOf, valueOf);
        var named = groups.map(function (group) {
            return {
                key: group.key,
                name: nameOf(group.key),
                value: group.value,
                members: sortMembers(group.members, scoreOf)
            };
        });
        return PerspectivesLogic.assignRanks(named, function (entry) {
            return entry.value;
        });
    }

    return {
        aggregateByGroup: aggregateByGroup,
        sortMembers: sortMembers
    };
}));
