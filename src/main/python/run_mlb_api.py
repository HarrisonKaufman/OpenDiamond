"""Reads JSON from stdin, calls MLB API, writes JSON to stdout."""
import json
import sys
from mlb_api import get_game, get_game_box_score, get_standings, get_team, get_player_stat_by_name_season, get_player_season_stats

def validate_action(payload):
    action = payload.get("action")
    if not action:
        return None, {"error": "Missing required field: action"}
    if not isinstance(action, str):
        return None, {"error": "Invalid action type - must be a string"}

    valid_actions = ["game", "boxscore", "standings", "team", "player_stats", "player_season_stats"]
    if action not in valid_actions:
        return None, {"error": f"Invalid action '{action}'. Valid actions: {', '.join(valid_actions)}"}

    return action, None

def validate_game_id(payload):
    if "gameId" not in payload:
        return None, {"error": "Missing required field: gameId"}

    try:
        game_id = int(payload["gameId"])
        if game_id <= 0:
            return None, {"error": "gameId must be a positive integer"}
        return game_id, None
    except (ValueError, TypeError):
        return None, {"error": "Invalid gameId - must be a valid integer"}

def validate_team_id(payload):
    if "teamId" not in payload:
        return None, {"error": "Missing required field: teamId"}

    try:
        team_id = int(payload["teamId"])
        if team_id <= 0:
            return None, {"error": "teamId must be a positive integer"}
        return team_id, None
    except (ValueError, TypeError):
        return None, {"error": "Invalid teamId - must be a valid integer"}

def validate_player_name(payload):
    if "playerName" not in payload:
        return None, {"error": "Missing required field: playerName"}

    player_name = payload["playerName"]
    if not isinstance(player_name, str):
        return None, {"error": "playerName must be a string"}

    player_name = player_name.strip()
    if not player_name:
        return None, {"error": "playerName cannot be empty"}

    if len(player_name) > 100:
        return None, {"error": "playerName is too long (max 100 characters)"}

    return player_name, None

try:
    payload = json.load(sys.stdin)

    if not isinstance(payload, dict):
        print(json.dumps({"error": "Invalid payload - must be a JSON object"}))
        sys.exit(1)

    action, error = validate_action(payload)
    if error:
        print(json.dumps(error))
        sys.exit(1)

    result = None

    if action == "game":
        game_id, error = validate_game_id(payload)
        if error:
            print(json.dumps(error))
            sys.exit(1)
        result = get_game(game_id)

    elif action == "boxscore":
        game_id, error = validate_game_id(payload)
        if error:
            print(json.dumps(error))
            sys.exit(1)
        result = get_game_box_score(game_id)

    elif action == "standings":
        league_id = payload.get("leagueId", 103)
        try:
            league_id = int(league_id)
        except (ValueError, TypeError):
            print(json.dumps({"error": "Invalid leagueId - must be an integer"}))
            sys.exit(1)
        result = get_standings(league_id)

    elif action == "team":
        team_id, error = validate_team_id(payload)
        if error:
            print(json.dumps(error))
            sys.exit(1)
        result = get_team(team_id)

    elif action == "player_stats":
        player_name, error = validate_player_name(payload)
        if error:
            print(json.dumps(error))
            sys.exit(1)

        season = payload.get("season", 2024)
        try:
            season = int(season)
            if season < 1900 or season > 2100:
                print(json.dumps({"error": "season must be between 1900 and 2100"}))
                sys.exit(1)
        except (ValueError, TypeError):
            print(json.dumps({"error": "Invalid season - must be an integer"}))
            sys.exit(1)

        result = get_player_stat_by_name_season(player_name, season)

    elif action == "player_season_stats":
        player_name, error = validate_player_name(payload)
        if error:
            print(json.dumps(error))
            sys.exit(1)
        result = get_player_season_stats(player_name)

    print(json.dumps(result))

except json.JSONDecodeError:
    print(json.dumps({"error": "Invalid JSON input"}))
    sys.exit(1)
except Exception as e:
    import logging as _logging
    _logging.getLogger(__name__).exception("Unexpected error: %s", e)
    print(json.dumps({"error": "An unexpected error occurred. Please try again later."}))
    sys.exit(1)
