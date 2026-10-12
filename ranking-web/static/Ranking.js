/* Programming contest management system
 * Copyright © 2012 Luca Wehrstedt <luca.wehrstedt@gmail.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

if (!window.console) {
    window.console = new Object();
}

if (!window.console.log) {
    window.console.log = function () {};
}

if (!window.console.info) {
    window.console.info = function () {};
}

if (!window.console.warn) {
    window.console.warn = function () {};
}

if (!window.console.error) {
    window.console.error = function () {};
}

$(document).ready(function() {
    DataStore.init(function(){
        HistoryStore.init();
        UserDetail.init();
        TimeView.init();
        TeamSearch.init(function() {
          DataStore.init_selections();
        });
        Overview.init();
        Scoreboard.init();
        GraphPanel.init();
    });
});

var GraphPanel = new function () {
    var self = this;
    var chart = null;
    var frozenFeed = {};

    function taskList() {
        var out = [];
        var contests = DataStore.contest_list;
        for (var i in contests) {
            var tasks = contests[i].tasks;
            for (var j in tasks) {
                out.push({ id: tasks[j].key, name: tasks[j].short_name || tasks[j].name, max: tasks[j].max_score });
            }
        }
        return out;
    }

    function displayName(u_id) {
        var renamed = DataStore.rename_for(u_id);
        if (renamed !== null) return renamed;
        var user = DataStore.users[u_id];
        var name = (user.f_name + ' ' + user.l_name).trim();
        return name || u_id;
    }

    function liveRow(u_id, tasks) {
        var user = DataStore.users[u_id];
        var scores = {};
        for (var i in tasks) {
            var v = user['t_' + tasks[i].id];
            scores[tasks[i].id] = (v == null) ? 0 : v;
        }
        return { id: u_id, name: displayName(u_id), scores: scores, raw: user };
    }

    function feedChart() {
        if (!chart) return;
        var tasks = taskList();
        var users = [];
        for (var u_id in DataStore.users) {
            if (DataStore.is_hidden(u_id)) continue;
            if (frozenFeed[u_id]) users.push(frozenFeed[u_id]);
            else users.push(liveRow(u_id, tasks));
        }
        var guests = DataStore.guest_rows();
        for (var g in guests) {
            var row = guests[g];
            var scores = {};
            for (var i in tasks) scores[tasks[i].id] = 0;
            users.push({ id: row.target_key, name: row.value || row.target_key, scores: scores, raw: row });
        }
        chart.setData({ tasks: tasks, users: users });
    }

    function snapshotFreezes() {
        var tasks = taskList();
        var next = {};
        for (var u_id in DataStore.users) {
            if (DataStore.freeze_hit_for(u_id) !== null) {
                next[u_id] = frozenFeed[u_id] || liveRow(u_id, tasks);
            }
        }
        frozenFeed = next;
    }

    self.init = function () {
        if (!window.d3 || !window.ScoreChart) return;
        chart = ScoreChart.create('#GraphPanel', { autoPosition: false });
        DataStore.score_events.add(function () { feedChart(); });
        DataStore.override_events.add(function () { snapshotFreezes(); feedChart(); });
        feedChart();
    };
}();
