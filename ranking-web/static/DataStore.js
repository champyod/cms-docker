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

function round(value, ndigits) {
    value *= Math.pow(10, ndigits);
    value = Math.round(value);
    value /= Math.pow(10, ndigits);
    return value;
}

function round_to_str(value, ndigits) {
    if (ndigits > 0) {
        // Remove trailing zeroes
        return value.toFixed(ndigits).replace(/\.?0+$/, "");
    } else {
        return value.toFixed(0);
    }
}

var DataStore = new function () {
    var self = this;

    self.contests = new Object();
    self.tasks = new Object();
    self.teams = new Object();
    self.users = new Object();

    self.contest_create = $.Callbacks();
    self.contest_update = $.Callbacks();
    self.contest_delete = $.Callbacks();
    self.task_create = $.Callbacks();
    self.task_update = $.Callbacks();
    self.task_delete = $.Callbacks();
    self.team_create = $.Callbacks();
    self.team_update = $.Callbacks();
    self.team_delete = $.Callbacks();
    self.user_create = $.Callbacks();
    self.user_update = $.Callbacks();
    self.user_delete = $.Callbacks();

    self.score_events = $.Callbacks();
    self.rank_events = $.Callbacks();


    ////// Contest

    self.contest_count = 0;

    self.init_contests = function () {
        $.ajax({
            url: Config.get_contest_list_url(),
            dataType: "json",
            success: function (data, status, xhr) {
                self.contest_init_time = parseFloat(xhr.getResponseHeader("Timestamp"));
                for (var key in data) {
                    self.create_contest(key, data[key]);
                }
                self.init_tasks();
            },
            error: function () {
                console.error("Error while getting the list of contests");
                self.update_network_status(4);
            }
        });
    }

    self.contest_listener = function (event) {
        var cmd = event.data.split(" ");
        if (cmd[0] == "create") {
            $.ajax({
                url: Config.get_contest_read_url(cmd[1]),
                dataType: "json",
                success: function (data) {
                    self.create_contest(cmd[1], data);
                },
                error: function () {
                    console.error("Error while getting contest " + cmd[1]);
                    self.es.close();
                    self.update_network_status(4);
                }
            });
        } else if (cmd[0] == "update") {
            $.ajax({
                url: Config.get_contest_read_url(cmd[1]),
                dataType: "json",
                success: function (data) {
                    self.update_contest(cmd[1], data);
                },
                error: function () {
                    console.error("Error while getting contest " + cmd[1]);
                    self.es.close();
                    self.update_network_status(4);
                }
            });
        } else if (cmd[0] == "delete") {
            self.delete_contest(cmd[1]);
        }
    };

    self.create_contest = function (key, data) {
        data["key"] = key;
        self.contests[key] = data;

        console.info("Created contest " + key);
        console.log(data);

        self.contest_count += 1;

        self.contest_create.fire(key, data);
    };

    self.update_contest = function (key, data) {
        var old_data = self.contests[key];

        data["key"] = key;
        self.contests[key] = data;

        console.info("Updated contest " + key);
        console.log(old_data);
        console.log(data);

        self.contest_update.fire(key, old_data, data);
    };

    self.delete_contest = function (key) {
        var old_data = self.contests[key];

        delete self.contests[key];

        console.info("Deleted contest " + key);
        console.log(old_data);

        self.contest_count -= 1;

        self.contest_delete.fire(key, old_data);
    };


    ////// Task

    self.task_count = 0;

    self.init_tasks = function () {
        $.ajax({
            url: Config.get_task_list_url(),
            dataType: "json",
            success: function (data, status, xhr) {
                self.task_init_time = parseFloat(xhr.getResponseHeader("Timestamp"));
                for (var key in data) {
                    self.create_task(key, data[key]);
                }
                self.inits_todo -= 1;
                if (self.inits_todo == 0) {
                    self.init_scores();
                }
            },
            error: function () {
                console.error("Error while getting the list of tasks");
                self.update_network_status(4);
            }
        });
    }

    self.task_listener = function (event) {
        var cmd = event.data.split(" ");
        if (cmd[0] == "create") {
            $.ajax({
                url: Config.get_task_read_url(cmd[1]),
                dataType: "json",
                success: function (data) {
                    self.create_task(cmd[1], data);
                },
                error: function () {
                    console.error("Error while getting task " + cmd[1]);
                    self.es.close();
                    self.update_network_status(4);
                }
            });
        } else if (cmd[0] == "update") {
            $.ajax({
                url: Config.get_task_read_url(cmd[1]),
                dataType: "json",
                success: function (data) {
                    self.update_task(cmd[1], data);
                },
                error: function () {
                    console.error("Error while getting task " + cmd[1]);
                    self.es.close();
                    self.update_network_status(4);
                }
            });
        } else if (cmd[0] == "delete") {
            self.delete_task(cmd[1]);
        }
    };

    self.create_task = function (key, data) {
        if (self.contests[data["contest"]] === undefined)
        {
            console.error("Could not find contest " + data["contest"] + " for task " + key);
            if (self.es) {
                self.es.close();
            }
            self.update_network_status(4);
            return;
        }

        data["key"] = key;
        self.tasks[key] = data;

        console.info("Created task " + key);
        console.log(data);

        self.task_count += 1;

        self.task_create.fire(key, data);
    };

    self.update_task = function (key, data) {
        var old_data = self.tasks[key];

        data["key"] = key;
        self.tasks[key] = data;

        console.info("Updated task " + key);
        console.log(old_data);
        console.log(data);

        self.task_update.fire(key, old_data, data);
    };

    self.delete_task = function (key) {
        var old_data = self.tasks[key];

        delete self.tasks[key];

        console.info("Deleted task " + key);
        console.log(old_data);

        self.task_count -= 1;

        self.task_delete.fire(key, old_data);
    };


    ////// Team

    self.team_count = 0;

    self.init_teams = function () {
        $.ajax({
            url: Config.get_team_list_url(),
            dataType: "json",
            success: function (data, status, xhr) {
                self.team_init_time = parseFloat(xhr.getResponseHeader("Timestamp"));
                for (var key in data) {
                    self.create_team(key, data[key]);
                }
                self.init_board();
            },
            error: function () {
                console.error("Error while getting the list of teams");
                self.update_network_status(4);
            }
        });
    }

    self.team_listener = function (event) {
        var cmd = event.data.split(" ");
        if (cmd[0] == "create") {
            $.ajax({
                url: Config.get_team_read_url(cmd[1]),
                dataType: "json",
                success: function (data) {
                    self.create_team(cmd[1], data);
                },
                error: function () {
                    console.error("Error while getting team " + cmd[1]);
                    self.es.close();
                    self.update_network_status(4);
                }
            });
        } else if (cmd[0] == "update") {
            $.ajax({
                url: Config.get_team_read_url(cmd[1]),
                dataType: "json",
                success: function (data) {
                    self.update_team(cmd[1], data);
                },
                error: function () {
                    console.error("Error while getting team " + cmd[1]);
                    self.es.close();
                    self.update_network_status(4);
                }
            });
        } else if (cmd[0] == "delete") {
            self.delete_team(cmd[1]);
        }
    };

    self.create_team = function (key, data) {
        data["key"] = key;
        self.teams[key] = data;

        console.info("Created team " + key);
        console.log(data);

        self.team_count += 1;

        self.team_create.fire(key, data);
    };

    self.update_team = function (key, data) {
        var old_data = self.teams[key];

        data["key"] = key;
        self.teams[key] = data;

        console.info("Updated team " + key);
        console.log(old_data);
        console.log(data);

        self.team_update.fire(key, old_data, data);
    };

    self.delete_team = function (key) {
        var old_data = self.teams[key];

        delete self.teams[key];

        console.info("Deleted team " + key);
        console.log(old_data);

        self.team_count -= 1;

        self.team_delete.fire(key, old_data);
    };


    ////// User

    self.user_count = 0;

    self.init_users = function () {
        $.ajax({
            url: Config.get_user_list_url(),
            dataType: "json",
            success: function (data, status, xhr) {
                self.user_init_time = parseFloat(xhr.getResponseHeader("Timestamp"));
                for (var key in data) {
                    self.create_user(key, data[key]);
                }
                self.inits_todo -= 1;
                if (self.inits_todo == 0) {
                    self.init_scores();
                }
            },
            error: function () {
                console.error("Error while getting the list of users");
                self.update_network_status(4);
            }
        });
    }


    ////// Board

    /* The board carries display names, teams, override-applied scores and the
       server's ranks, so the page draws a rename, a hide, a guest, a score or a pin
       without recomputing any of it. A board that cannot be read falls back to the
       raw user and score lists and the client-side ranking. */

    self.board_authoritative = false;
    self.board_init_time = 0;
    self.board_ready = false;
    self.board_refresh_timer = null;

    self.init_board = function () {
        $.ajax({
            url: Config.get_board_url(),
            dataType: "json",
            success: function (data, status, xhr) {
                self.board_init_time = parseFloat(xhr.getResponseHeader("Timestamp"));
                self.user_init_time = self.board_init_time;
                self.apply_board(data);
                self.inits_todo -= 1;
                if (self.inits_todo == 0) {
                    self.init_scores();
                }
            },
            error: function () {
                console.error("Error while getting the board, using the raw lists");
                self.init_users();
            }
        });
    };

    self.apply_board = function (data) {
        self.board_authoritative = true;

        var seen = {};
        for (var key in data) {
            seen[key] = true;
            var row = data[key];
            if (self.users[key] === undefined) {
                self.create_user(key, {"f_name": row["f_name"], "l_name": row["l_name"],
                                       "team": (row["team"] === undefined ? null : row["team"])});
            }
            var user = self.users[key];
            user["f_name"] = row["f_name"];
            user["l_name"] = row["l_name"];
            user["team"] = row["team"];
            user["global"] = row["score"];
            user["rank"] = row["rank"];
            user["board"] = true;
            if (self.board_ready) {
                self.user_update.fire(key, user, user);
                self.rank_events.fire(key, user, 0);
                self.score_events.fire(key, user, null, null, 0);
            }
        }

        var gone = new Array();
        for (var k in self.users) {
            if (!seen[k]) {
                gone.push(k);
            }
        }
        for (var i = 0; i < gone.length; i += 1) {
            self.delete_user(gone[i]);
        }
    };

    self.schedule_board_refresh = function () {
        if (!self.board_ready || !self.board_authoritative || document.hidden) {
            return;
        }
        if (self.board_refresh_timer) {
            clearTimeout(self.board_refresh_timer);
        }
        self.board_refresh_timer = setTimeout(function () {
            self.board_refresh_timer = null;
            $.ajax({
                url: Config.get_board_url(),
                dataType: "json",
                success: function (data) {
                    self.apply_board(data);
                },
                error: function () {
                    self.update_network_status(4);
                }
            });
        }, 400);
    };

    self.user_listener = function (event) {
        var cmd = event.data.split(" ");
        if (cmd[0] == "create") {
            $.ajax({
                url: Config.get_user_read_url(cmd[1]),
                dataType: "json",
                success: function (data) {
                    self.create_user(cmd[1], data);
                },
                error: function () {
                    console.error("Error while getting user " + cmd[1]);
                    self.es.close();
                    self.update_network_status(4);
                }
            });
        } else if (cmd[0] == "update") {
            $.ajax({
                url: Config.get_user_read_url(cmd[1]),
                dataType: "json",
                success: function (data) {
                    self.update_user(cmd[1], data);
                },
                error: function () {
                    console.error("Error while getting user " + cmd[1]);
                    self.es.close();
                    self.update_network_status(4);
                }
            });
        } else if (cmd[0] == "delete") {
            self.delete_user(cmd[1]);
        }
    };

    self.create_user = function (key, data) {
        if (data["team"] !== null && self.teams[data["team"]] === undefined)
        {
            console.error("Could not find team " + data["team"] + " for user " + key);
            if (self.es) {
                self.es.close();
            }
            self.update_network_status(4);
            return;
        }

        data["key"] = key;
        self.users[key] = data;

        console.info("Created user " + key);
        console.log(data);

        self.user_count += 1;

        self.user_create.fire(key, data);
    };

    self.update_user = function (key, data) {
        var old_data = self.users[key];

        data["key"] = key;
        self.users[key] = data;

        console.info("Updated user " + key);
        console.log(old_data);
        console.log(data);

        self.user_update.fire(key, old_data, data);
    };

    self.delete_user = function (key) {
        var old_data = self.users[key];

        delete self.users[key];

        console.info("Deleted user " + key);
        console.log(old_data);

        self.user_count -= 1;

        self.user_delete.fire(key, old_data);
    };


    ////// Default scores

    self.global_max_score = 0.0;
    self.global_score_precision = 0;

    self.contest_create.add(function (key, data) {
        // Add scores
        for (var u_id in self.users) {
            self.users[u_id]["c_" + key] = 0.0;
        }
        // Maximum score
        data["max_score"] = 0.0;
        // Global score precision
        self.global_score_precision = 0;
        for (var c_id in self.contests) {
            self.global_score_precision = Math.max(self.global_score_precision, self.contests[c_id]["score_precision"]);
        }
    });

    self.contest_update.add(function (key, old_data, data) {
        // Maximum score
        data["max_score"] = old_data["max_score"];
        delete old_data["max_score"];
        // Global score precision
        self.global_score_precision = 0;
        for (var c_id in self.contests) {
            self.global_score_precision = Math.max(self.global_score_precision, self.contests[c_id]["score_precision"]);
        }
    });

    self.contest_delete.add(function (key, old_data) {
        // Remove scores
        for (var u_id in self.users) {
            delete self.users[u_id]["c_" + key];
        }
        // Maximum score
        delete old_data["max_score"];
        // Global score precision
        self.global_score_precision = 0;
        for (var c_id in self.contests) {
            self.global_score_precision = Math.max(self.global_score_precision, self.contests[c_id]["score_precision"]);
        }
    });

    self.task_create.add(function (key, data) {
        // Add scores
        for (var u_id in self.users) {
            self.users[u_id]["t_" + key] = 0.0;
        }
        // Maximum score
        self.contests[data["contest"]]["max_score"] += data["max_score"];
        self.global_max_score += data["max_score"];
    });

    self.task_update.add(function (key, old_data, data) {
        /* TODO: We may want to check that all scores are still less than or
           equal to the maximum achievable score. Or we may assume that this is
           handled by the server.
         */
        // Maximum score
        self.contests[old_data["contest"]]["max_score"] -= old_data["max_score"];
        self.global_max_score -= old_data["max_score"];
        self.contests[data["contest"]]["max_score"] += data["max_score"];
        self.global_max_score += data["max_score"];
    });

    self.task_delete.add(function (key, old_data) {
        // Remove scores
        for (var u_id in self.users) {
            delete self.users[u_id]["t_" + key];
        }
        // Maximum score
        self.contests[old_data["contest"]]["max_score"] -= old_data["max_score"];
        self.global_max_score -= old_data["max_score"];
    });

    self.user_create.add(function (key, data) {
        // Add scores
        for (var t_id in self.tasks) {
            data["t_" + t_id] = 0.0;
        }
        for (var c_id in self.contests) {
            data["c_" + c_id] = 0.0;
        }
        data["global"] = 0.0;
    });

    self.user_update.add(function (key, old_data, data) {
        // Copy scores
        for (var t_id in self.tasks) {
            data["t_" + t_id] = old_data["t_" + t_id];
            delete old_data["t_" + t_id];
        }
        for (var c_id in self.contests) {
            data["c_" + c_id] = old_data["c_" + c_id];
            delete old_data["c_" + c_id];
        }
        data["global"] = old_data["global"];
        delete old_data["global"];
    });

    self.user_delete.add(function (key, old_data) {
        // Remove scores
        for (var t_id in self.tasks) {
            delete old_data["t_" + t_id];
        }
        for (var c_id in self.contests) {
            delete old_data["c_" + c_id];
        }
        delete old_data["global"];
    });


    ////// Score

    self.init_scores = function () {
        $.ajax({
            url: Config.get_score_url(),
            dataType: "json",
            success: function (data, status, xhr) {
                self.score_init_time = parseFloat(xhr.getResponseHeader("Timestamp"));
                for (var u_id in data) {
                    for (var t_id in data[u_id]) {
                        self.set_score(u_id, t_id, data[u_id][t_id]);
                    }
                }
                self.init_ranks();
            },
            error: function () {
                console.error("Error while getting the scores");
                self.update_network_status(4);
            }
        });
    };

    self.score_listener = function (event) {
        var data = event.data.split("\n");
        for (var idx in data) {
            var line = data[idx].split(" ");
            self.set_score(line[0], line[1], parseFloat(line[2]));
        }
    };

    /* A live board delta: "<key> <score> <rank>" for a moved row and "<key>" for a row
       that left, so the page updates in place instead of refetching the whole board. A
       key the page has never seen carries a name it does not have yet, so that one case
       falls back to the full read. */
    self.board_listener = function (event) {
        var lines = event.data.split("\n");
        for (var i = 0; i < lines.length; i += 1) {
            if (lines[i] === "") {
                continue;
            }
            var parts = lines[i].split(" ");
            var key = parts[0];
            if (parts.length >= 3) {
                var user = self.users[key];
                if (user === undefined) {
                    self.schedule_board_refresh();
                    return;
                }
                user["global"] = parseFloat(parts[1]);
                user["rank"] = parseInt(parts[2], 10);
                self.rank_events.fire(key, user, 0);
                self.score_events.fire(key, user, null, null, 0);
            } else if (self.users[key] !== undefined) {
                self.delete_user(key);
            }
        }
    };

    self.set_score = function (u_id, t_id, new_t_score) {
        var user = self.users[u_id];
        var task = self.tasks[t_id];
        // A hidden user is on the raw score list but not on the board: skip it rather
        // than draw a row an override removed.
        if (user === undefined || task === undefined) {
            return;
        }

        var c_id = task["contest"];
        var contest = self.contests[c_id];

        // Task
        new_t_score = round(new_t_score, task["score_precision"]);
        var old_t_score = user["t_" + t_id];
        user["t_" + t_id] = new_t_score;

        // Contest
        var new_c_score = 0.0;  // = sum(user's score on t for t in contest.tasks)
        for (var i = 0; i < contest.tasks.length; i += 1) {
            new_c_score += user["t_" + contest.tasks[i].key];
        }
        new_c_score = round(new_c_score, contest["score_precision"]);
        var old_c_score = user["c_" + c_id];
        user["c_" + c_id] = new_c_score;

        // Global. When the server owns the board it owns the aggregate too, because an
        // override may replace it: recomputing it from the tasks would erase the override.
        var old_g_score = user["global"];
        var new_g_score = old_g_score;
        if (!self.board_authoritative) {
            new_g_score = 0.0;  // = sum(user's score on c for c in self.contest_list)
            for (var i = 0; i < self.contest_list.length; i += 1) {
                new_g_score += user["c_" + self.contest_list[i].key];
            }
            new_g_score = round(new_g_score, self.global_score_precision);
            user["global"] = new_g_score;
        }

        console.info("Changed score for user " + u_id + " and task " + t_id + ": " + old_t_score + " -> " + new_t_score);

        self.score_events.fire(u_id, user, t_id, task, new_g_score - old_g_score);
    };

    self.get_score_t = function (u_id, t_id) {
        return self.users[u_id]["t_" + t_id];
    };

    self.get_score_c = function (u_id, c_id) {
        return self.users[u_id]["c_" + c_id];
    };

    self.get_score = function (u_id) {
        return self.users[u_id]["global"];
    };


    ////// Rank

    self.init_ranks = function () {
        // When the server owns the board it owns the ranks too: the client keeps them
        // fresh by re-reading the board on a live change, instead of ranking the raw
        // scores again, which would ignore an override.
        if (self.board_authoritative) {
            self.board_ready = true;
            // Ranks and totals arrive as live board deltas, so the page does not refetch
            // the board on every score; a board it fell behind on is caught up when the
            // tab becomes visible again.
            $(document).on("visibilitychange", function () {
                if (!document.hidden) {
                    self.schedule_board_refresh();
                }
            });
            self.create_event_source();
            self.init_callback();
            return;
        }

        // Make a list of all users
        var list = new Array();

        for (var u_id in self.users) {
            list.push(self.users[u_id]);
        }

        // Sort it by decreasing score
        list.sort(function (a, b) {
            return b["global"] - a["global"];
        });

        // Assign ranks
        var prev_score = null;
        var rank = 0;
        var equal = 1;

        for (var i in list) {
            user = list[i];
            score = user["global"];

            if (score === prev_score) {
                equal += 1;
            } else {
                prev_score = score;
                rank += equal;
                equal = 1;
            }

            user["rank"] = rank;
        }

        self.score_events.add(self.update_rank);

        self.user_create.add(function (u_id, user) {
            /* We're actually just counting how many users have a non-zero
               global score and setting the rank of the new user to that number
               plus one. An optimization could be to store that number and to
               keep it up-to-date (instead of computing it every time). But
               since user creation is a rare event we could keep it this way.
             */
            var new_rank = 1;

            for (var u_id in self.users) {
                if (self.users[u_id]["global"] > user["global"]) {
                    new_rank += 1;
                }
            }

            user["rank"] = new_rank;
        });

        self.user_update.add(function (u_id, old_user, user) {
            user["rank"] = old_user["rank"];
            delete old_user["rank"];
        });

        self.user_update.add(function (u_id, old_user) {
            /* We're assuming that the user has its score set to zero and thus
               has the highest possible rank (this is because the server should
               have already deleted all its submissions and subchanges). So its
              deletion won't cause changes in others' ranks.
             */
            delete old_user["rank"];
        });

        self.create_event_source();
        self.init_callback();
    };

    self.update_rank = function (u_id, user) {
        /* The rank of a user is defined as the number of other users that have
           a score greater than theirs, plus one. Note that:
               a.score < b.score if and only if a.rank > b.rank
               a.score = b.score if and only if a.rank = b.rank
               a.score > b.score if and only if a.rank < b.rank
           Thus it's the same to sort by ascending score or by descending rank,
           and vice versa.
           When a user's score is updated (e.g. it changes from old_score to
           new_score with new_score > old_score) it can be shown that:
             - all users whose score is >= new_score don't change their rank
             - all users whose score is < old_score don't change their rank
             - all other users have their rank increased by exactly one
           A similar proposition holds when new_score < old_score.
         */

        // We don't know old_score but we'll see that it's not needed.
        var new_score = user["global"];
        var old_rank = user["rank"];
        // The new rank is computed by strictly applying the definition:
        //     new_rank = 1 + |{user2 in users, user2.score > user.score}|
        var new_rank = 1;

        for (var u2_id in self.users) {
            var user2 = self.users[u2_id];
            // this condition is equivalent to
            //     old_score <= user2["global"] < new_score
            if (old_rank >= user2["rank"] && user2["global"] < new_score) {
                user2["rank"] += 1;
                self.rank_events.fire(u2_id, user2, +1);
            // this condition is equivalent to
            //     new_score <= user2["global"] < old_score
            } else if (new_score <= user2["global"] && user2["rank"] > old_rank) {
                user2["rank"] -= 1;
                self.rank_events.fire(u2_id, user2, -1);
            }
            if (user2["global"] > new_score) {
                new_rank += 1;
            }
        }

        user["rank"] = new_rank;

        if (old_rank != new_rank) {
            console.info("Changed rank for user " + u_id + ": " + old_rank + " -> " + new_rank);

            self.rank_events.fire(u_id, user, new_rank - old_rank);
        }
    };


    ////// Initialization

    /* The init process works this way:
       - we start init_contests() and init_teams()
       - they each start an asynchronous AJAX request
       - when the requests end their data is processed and then, respectively,
         init_tasks() and init_users() are called
       - they also start an AJAX request and process its data
       - when BOTH requests finish init_scores() is called
       - it does again an AJAX request and processes its data
       - at the end it calls init_ranks() which calls init_callback()
       - Subsequently, when TeamStore is initialized, we call init_selections().
     */

    self.init = function (callback) {
        self.inits_todo = 2;
        self.init_callback = callback;

        self.init_contests();
        self.init_teams();
    };


    ////// Event listeners

    /* We set the listeners for Server Sent Events. */

    self.last_event_id = null;

    self.create_event_source = function () {
        if (self.last_event_id == null) {
            self.last_event_id = Math.round(Math.min(self.contest_init_time,
                                                     self.task_init_time,
                                                     self.team_init_time,
                                                     self.user_init_time,
                                                     self.score_init_time) * 1000000).toString(16);
        }

        if (self.es) {
            delete self.es;
        }

        self.es = new EventSource(Config.get_event_url(self.last_event_id));

        self.es.addEventListener("open", self.es_open_handler, false);
        self.es.addEventListener("error", self.es_error_handler, false);
        self.es.addEventListener("reload", self.es_reload_handler, false);
        self.es.addEventListener("contest", function (event) {
            var timestamp = parseInt(event.lastEventId, 16) / 1000000;
            if (timestamp > self.contest_init_time) {
                self.contest_listener(event);
            }
            self.last_event_id = event.lastEventId;
        }, false);
        self.es.addEventListener("task", function (event) {
            var timestamp = parseInt(event.lastEventId, 16) / 1000000;
            if (timestamp > self.task_init_time) {
                self.task_listener(event);
            }
            self.last_event_id = event.lastEventId;
        }, false);
        self.es.addEventListener("team", function (event) {
            var timestamp = parseInt(event.lastEventId, 16) / 1000000;
            if (timestamp > self.team_init_time) {
                self.team_listener(event);
            }
            self.last_event_id = event.lastEventId;
        }, false);
        self.es.addEventListener("user", function (event) {
            var timestamp = parseInt(event.lastEventId, 16) / 1000000;
            if (timestamp > self.user_init_time) {
                self.user_listener(event);
                // A name or team change moves the board the page draws; the board
                // delta carries no names, so this one path re-reads the board.
                self.schedule_board_refresh();
            }
            self.last_event_id = event.lastEventId;
        }, false);
        self.es.addEventListener("score", function (event) {
            var timestamp = parseInt(event.lastEventId, 16) / 1000000;
            if (timestamp > self.score_init_time) {
                self.score_listener(event);
            }
            self.last_event_id = event.lastEventId;
        }, false);
        self.es.addEventListener("board", function (event) {
            var timestamp = parseInt(event.lastEventId, 16) / 1000000;
            if (timestamp > self.score_init_time) {
                self.board_listener(event);
            }
            self.last_event_id = event.lastEventId;
        }, false);
    };

    self.update_network_status = function (state) {
        if (state == 0) { // self.es.CONNECTING
            $("#ConnectionStatus_box").attr("data-status", "reconnecting");
            $("#ConnectionStatus_text").text("You are disconnected from the server but your browser is trying to connect.");
        } else if (state == 1) { // self.es.OPEN
            $("#ConnectionStatus_box").attr("data-status", "connected");
            $("#ConnectionStatus_text").text("You are connected to the server and are receiving live updates.");
        } else if (state == 2) { // self.es.CLOSED
            $("#ConnectionStatus_box").attr("data-status", "disconnected");
            $("#ConnectionStatus_text").html("You are disconnected from the server but you can <a onclick=\"DataStore.create_event_source();\">try to connect</a>.");
        } else if (state == 3) { // "reload" event received
            $("#ConnectionStatus_box").attr("data-status", "outdated");
            $("#ConnectionStatus_text").html("Your local data cannot be updated. Please <a onclick=\"window.location.reload();\">reload the page</a>.");
        } else if (state == 4) { // an init failed
            $("#ConnectionStatus_box").attr("data-status", "init_error");
            $("#ConnectionStatus_text").html("An error occurred while loading the data. Check your connection and <a onclick=\"window.location.reload();\">reload the page</a>.");
        }
    };

    self.es_open_handler = function () {
        if (self.es.readyState == self.es.OPEN) {
            console.info("EventSource connected");
            self.update_network_status(self.es.readyState);
        } else {
            console.error("EventSource shouldn't be in state " + self.es.readyState + " during a 'open' event!");
        }
    };

    self.es_error_handler = function () {
        if (self.es.readyState == self.es.CONNECTING) {
            console.info("EventSource reconnecting");
            self.update_network_status(self.es.readyState);
        } else if (self.es.readyState == self.es.CLOSED) {
            console.info("EventSource disconnected");
            self.update_network_status(self.es.readyState);
        } else {
            console.error("EventSource shouldn't be in state " + self.es.readyState + " during a 'error' event!");
        }
    };

    self.es_reload_handler = function () {
        if (self.es.readyState == self.es.OPEN) {
            console.info("Received a 'reload' event");
            self.es.close();
            self.update_network_status(3);
        } else {
            console.error("EventSource shouldn't be in state " + self.es.readyState + " during a 'reload' event!");
        }
    };

    $(document).ready(function () {
        self.update_network_status(0);
    });

    self.team_create.add(function() {
        $(document.body).removeClass("teams-hidden");
    });


    ////// Sorted contest list

    self.contest_list = new Array();

    self.contest_list_insert = function (key, data) {
        // Insert data in the sorted contest list
        var a = data;
        for (var i = 0; i < self.contest_list.length; i += 1) {
            var b = self.contest_list[i];
            if ((a["begin"] < b["begin"]) || ((a["begin"] == b["begin"]) &&
               ((a["end"]   < b["end"]  ) || ((a["end"]   == b["end"]  ) &&
               ((a["name"]  < b["name"] ) || ((a["name"]  == b["name"] ) &&
               (key < b["key"]))))))) {
                // We found the first element which is greater than a
                self.contest_list.splice(i, 0, a);
                return;
            }
        }
        self.contest_list.push(a);
    };

    self.contest_list_remove = function (key, old_data) {
        // Remove data from the sorted contest list
        for (var i = 0; i < self.contest_list.length; i += 1) {
            var b = self.contest_list[i];
            if (key == b["key"]) {
                self.contest_list.splice(i, 1);
                return;
            }
        }
    };

    self.contest_create.add(function (key, data) {
        data["tasks"] = new Array();
        self.contest_list_insert(key, data);
    });
    self.contest_update.add(function (key, old_data, data) {
        data["tasks"] = old_data["tasks"];
        delete old_data["tasks"];
        self.contest_list_remove(key, old_data);
        self.contest_list_insert(key, data);
    });
    self.contest_delete.add(function (key, old_data) {
        delete old_data["tasks"];
        self.contest_list_remove(key, old_data);
    });


    ////// Sorted task list

    self.task_list_insert = function (key, data) {
        var task_list = self.contests[data["contest"]]["tasks"];

        // Insert data in the sorted task list of the contest
        var a = data;
        for (var i = 0; i < task_list.length; i += 1) {
            var b = task_list[i];
            if ((a["order"] < b["order"]) || ((a["order"] == b["order"]) &&
               ((a["name"]  < b["name"] ) || ((a["name"]  == b["name"] ) &&
               (key < b["key"]))))) {
                // We found the first element which is greater than a
                task_list.splice(i, 0, a);
                return;
            }
        }
        task_list.push(a);
    };

    self.task_list_remove = function (key, old_data) {
        var task_list = self.contests[old_data["contest"]]["tasks"];

        // Remove data from the sorted task list of the contest
        for (var i = 0; i < task_list.length; i += 1) {
            var b = task_list[i];
            if (key == b["key"]) {
                task_list.splice(i, 1);
                break;
            }
        }
    };

    self.task_create.add(self.task_list_insert);
    self.task_update.add(function (key, old_data, data) {
        self.task_list_remove(key, old_data);
        self.task_list_insert(key, data);
    });
    self.task_delete.add(self.task_list_remove);


    ////// Sorted team list

    self.team_list = new Array();

    self.team_list_insert = function (key, data) {
        // Insert data in the sorted team list
        var a = data;
        for (var i = 0; i < self.team_list.length; i += 1) {
            var b = self.team_list[i];
            if ((a["name"] < b["name"]) || ((a["name"] == b["name"]) &&
                (key < b["key"]))) {
                // We found the first element which is greater than a
                self.team_list.splice(i, 0, a);
                return;
            }
        }
        self.team_list.push(a);
    };

    self.team_list_remove = function (key, old_data) {
        // Remove data from the sorted team list
        for (var i = 0; i < self.team_list.length; i += 1) {
            var b = self.team_list[i];
            if (key == b["key"]) {
                self.team_list.splice(i, 1);
                break;
            }
        }
    }

    self.team_create.add(function (key, data) {
        data["users"] = new Array();
        self.team_list_insert(key, data);
    });
    self.team_update.add(function (key, old_data, data) {
        data["users"] = old_data["users"];
        delete old_data["users"];
        self.team_list_remove(key, old_data);
        self.team_list_insert(key, data);
    });
    self.team_delete.add(function (key, old_data) {
        delete old_data["users"];
        self.team_list_remove(key, old_data);
    });


    ////// Sorted user list

    self.user_list_insert = function (key, data) {
        if (data["team"] == null) {
            return;
        }

        var user_list = self.teams[data["team"]]["users"];

        // Insert data in the sorted user list of the team
        var a = data;
        for (var i = 0; i < user_list.length; i += 1) {
            var b = user_list[i];
            if ((a["l_name"] < b["l_name"]) || ((a["l_name"] == b["l_name"]) &&
               ((a["f_name"] < b["f_name"]) || ((a["f_name"] == b["f_name"]) &&
               (key < b["key"]))))) {
                // We found the first element which is greater than a
                user_list.splice(i, 0, a);
                return;
            }
        }
        user_list.push(a);
    };

    self.user_list_remove = function (key, old_data) {
        if (old_data["team"] == null) {
            return;
        }

        var user_list = self.teams[old_data["team"]]["users"];

        // Remove data from the sorted user list of the team
        for (var i = 0; i < user_list.length; i += 1) {
            var b = user_list[i];
            if (key == b["key"]) {
                user_list.splice(i, 1);
                break;
            }
        }
    };

    self.user_create.add(self.user_list_insert);
    self.user_update.add(function (key, old_data, data) {
        self.user_list_remove(key, old_data);
        self.user_list_insert(key, data);
    });
    self.user_delete.add(self.user_list_remove);


    ////// Selection

    self.select_events = $.Callbacks();

    /* We use eight different colors. We keep track of how many times each
       color is in use and when we have to assign a new color to an user we
       choose the one that has been used less times.
     */

    self.colors = [0,0,0,0,0,0,0,0]

    self.choose_color = function () {
        var min_idx = 0;
        for (var i = 1; i < 8; i += 1)
        {
            if (self.colors[i] < self.colors[min_idx])
            {
                min_idx = i;
            }
        }
        // Color indexes will be 1-based, so we add 1 to the result
        return min_idx+1;
    }

    self.init_selections = function () {
        $.each(self.users, function (u_id) {
            var color_idx = parseInt(localStorage.getItem("cms.rws.selection.users." + u_id));
            if (color_idx > 0)
            {
                self.set_selected(u_id, true, color_idx);
            }
        });

        $(window).on("storage", function (event) {
            event = event.originalEvent;
            if (event.storageArea == localStorage)
            {
                if (event.key === null)
                {
                    // Triggered by a .clear().
                    $.each(self.users, function (u_id) {
                        self.set_selected(u_id, false);
                    });
                }
                else if (event.key.lastIndexOf("cms.rws.selection.users.", 0) === 0)
                {
                    var u_id = event.key.substr(24);
                    if (event.oldValue === null && event.newValue !== null)
                    {
                        self.set_selected(u_id, true, parseInt(event.newValue));
                    }
                    else if (event.oldValue !== null && event.newValue === null)
                    {
                        self.set_selected(u_id, false);
                    }
                }
            }
        });
    };

    self.set_selected = function (u_id, flag, color_idx) {
        // A row that has just been deleted still fires its delete callbacks; there is
        // nothing left to select, so the selection change is simply skipped.
        if (self.users[u_id] === undefined) {
            return;
        }
        if (self.users[u_id]["selected"] == 0 && flag) {
            // We have to assign a color
            if (!(color_idx > 0))
            {
                color_idx = self.choose_color();
            }
            self.users[u_id]["selected"] = color_idx;
            self.colors[color_idx-1] += 1;
            localStorage.setItem("cms.rws.selection.users." + u_id, color_idx);
            self.select_events.fire(u_id, color_idx);
        }
        else if (self.users[u_id]["selected"] != 0 && !flag) {
            // We have to remove the color
            var color_idx = self.users[u_id]["selected"];
            self.users[u_id]["selected"] = 0;
            self.colors[color_idx-1] -= 1;
            localStorage.removeItem("cms.rws.selection.users." + u_id);
            self.select_events.fire(u_id, 0);
        }
    };

    self.toggle_selected = function (u_id) {
        self.set_selected(u_id, self.users[u_id]["selected"] == 0);
    };

    self.get_selected = function (u_id) {
        return self.users[u_id]["selected"];
    };

    self.user_create.add(function (key, data) {
        data["selected"] = 0;
    });

    self.user_update.add(function (key, old_data, data) {
        data["selected"] = old_data["selected"];
        delete old_data["selected"];
    });

    self.user_delete.add(function (key, old_data) {
        self.set_selected(key, false);
        delete old_data["selected"];
    });
};
