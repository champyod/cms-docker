/* The group perspective: the board grouped by team, each row carrying the team
 * flag and expandable to the members behind the aggregate. It recomputes from
 * DataStore, so a live score change redraws it without a refetch. */

var PerspectiveGroup = new function () {
    var self = this;

    self.$el = null;

    self.teams = function () {
        var entries = [];
        for (var key in DataStore.users) {
            entries.push(DataStore.users[key]);
        }
        return PerspectivesGroupLogic.aggregateByGroup(
            entries,
            function (user) { return user["team"]; },
            function (user) { return user["global"]; },
            function (user) { return user["global"]; },
            self.team_name
        );
    };

    self.team_name = function (team) {
        var known = DataStore.teams[team];
        if (known === undefined || known["name"] === undefined) {
            return team;
        }
        return known["name"];
    };

    self.flag = function (team) {
        return '<img class="persp-group-flag" src="' + Config.get_flag_url(team) +
            '" alt="" />';
    };

    self.member_text = function (members) {
        if (members.length === 0) {
            return "No members";
        }
        var names = [];
        for (var index = 0; index < members.length; index += 1) {
            var member = members[index];
            names.push(escapeHTML(Perspectives.display_name(member["f_name"],
                member["l_name"])) + " \u00b7 " +
                round_to_str(member["global"], DataStore.global_score_precision));
        }
        return names.join(", ");
    };

    self.row = function (entry, index) {
        var id = "Persp_group_members_" + index;
        var name = Perspectives.anonymous ? "\u2014" : escapeHTML(entry.name);
        var body = '<tr>' +
            "<td>" + entry.rank + "</td>" +
            '<td class="persp-group-flag-cell">' + self.flag(entry.key) + "</td>" +
            "<td>" + name + "</td>" +
            '<td><button type="button" class="persp-group-toggle" data-target="' + id +
            '">' + entry.members.length + "</button></td>" +
            "<td>" + round_to_str(entry.value, DataStore.global_score_precision) + "</td>" +
            "</tr>";
        return body + '<tr class="persp-group-members" id="' + id + '">' +
            '<td colspan="5">' + self.member_text(entry.members) + "</td></tr>";
    };

    self.render = function () {
        if (self.$el === null) {
            return;
        }
        var teams = self.teams();
        var rows = "";
        for (var index = 0; index < teams.length; index += 1) {
            rows += self.row(teams[index], index);
        }
        self.$el.html('<table class="views-table persp-group"><thead><tr>' +
            "<th>Rank</th><th>Flag</th><th>Team</th><th>Members</th><th>Score</th>" +
            "</tr></thead><tbody>" + rows + "</tbody></table>");
        self.$el.find(".persp-group-toggle").on("click", function () {
            $("#" + $(this).data("target")).toggleClass("open");
        });
    };

    self.mount = function ($container) {
        self.$el = $container;
        self.render();
    };

    self.refresh = function () {
        self.render();
    };
};

Perspectives.register("group", function () {
    return {
        label: "Group",
        mount: PerspectiveGroup.mount,
        refresh: PerspectiveGroup.refresh
    };
});
