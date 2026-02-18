"""MLB Stats API wrapper."""

import datetime
import json
import logging
import urllib.request
from typing import Any, Dict, Optional

import statsapi

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def safe_int(value, default=0):
    try:
        if value is None or value == '':
            return default
        return int(float(str(value)))
    except (ValueError, TypeError):
        return default


def safe_float(value, default=0.0):
    try:
        if value is None or value == '':
            return default
        return float(str(value))
    except (ValueError, TypeError):
        return default


def _extract_position(person: Dict[str, Any]) -> str:
    try:
        return person.get('primaryPosition', {}).get('abbreviation', 'Unknown')
    except (KeyError, TypeError):
        return 'Unknown'


def get_game(game_id: int) -> Dict[str, Any]:
    return statsapi.get('game', {'gamePk': game_id})


def get_game_box_score(game_id: int) -> Dict[str, Any]:
    return statsapi.get('game_box_score', {'gamePk': game_id})


def get_player_stat_by_id(player_id: int) -> Dict[str, Any]:
    return statsapi.player_stat_data(player_id, 'hitting')


def _search_player(player_name: str) -> Optional[Dict[str, Any]]:
    """Try active roster first, then MLB search API. Returns player dict or None."""
    try:
        search_season = datetime.date.today().year
        sports_players = statsapi.get('sports_players', {'season': search_season, 'gameType': 'W'})
        for person in sports_players['people']:
            if person['fullName'].lower() == player_name.lower():
                return {
                    'id': person['id'],
                    'fullName': person['fullName'],
                    'primaryPosition': _extract_position(person),
                }
    except Exception:
        logger.debug("sports_players lookup failed, trying search API")

    try:
        encoded_name = urllib.request.quote(player_name)
        url = f'https://statsapi.mlb.com/api/v1/people/search?names={encoded_name}&sportIds=1'
        resp = urllib.request.urlopen(url, timeout=10)
        data = json.loads(resp.read())
        people = data.get('people', [])
        if people:
            person = people[0]
            return {
                'id': person['id'],
                'fullName': person['fullName'],
                'primaryPosition': _extract_position(person),
            }
    except Exception as e:
        logger.warning("people/search API failed: %s", e)

    return None


def get_player_stat_by_name_season(player_name: str, season: int) -> Dict[str, Any]:
    result = _search_player(player_name)
    if not result:
        return {"error": f"Player '{player_name}' not found"}

    stat_type = 'pitching' if result['primaryPosition'] == 'P' else 'hitting'
    stats_data = statsapi.player_stat_data(result['id'], stat_type, 'yearByYear')

    for entry in stats_data.get('stats', []):
        if isinstance(entry, dict) and safe_int(entry.get('season')) == season:
            return entry.get('stats', {})

    return {"error": f"No {stat_type} stats found for '{player_name}' in {season}"}


def get_player_season_stats(player_name: str, start_season: Optional[int] = None) -> Dict[str, Any]:
    try:
        search_result = _search_player(player_name)
        if not search_result:
            return {"error": f"Player '{player_name}' not found"}

        player_id = search_result['id']
        position = search_result['primaryPosition']
        stat_type = 'pitching' if position == 'P' else 'hitting'
        stats_data = statsapi.player_stat_data(player_id, stat_type, 'yearByYear')

        if 'stats' not in stats_data or len(stats_data['stats']) == 0:
            return {"error": f"No statistics found for player '{player_name}'"}

        seasons = []
        for season_entry in stats_data['stats']:
            if not isinstance(season_entry, dict):
                continue
            year = safe_int(season_entry.get('season'))
            stat_dict = season_entry.get('stats', {})
            if year <= 0 or not isinstance(stat_dict, dict):
                continue

            if position == 'P':
                walks = safe_int(stat_dict.get('baseOnBalls', 0))
                hits = safe_int(stat_dict.get('hits', 0))
                ip = safe_float(stat_dict.get('inningsPitched', 0.0))
                whip = (walks + hits) / ip if ip > 0 else 0.0
                seasons.append({
                    'position': position,
                    'year': year,
                    'wins': safe_int(stat_dict.get('wins', 0)),
                    'losses': safe_int(stat_dict.get('losses', 0)),
                    'era': safe_float(stat_dict.get('era', 0.0)),
                    'inningsPitched': ip,
                    'strikeOuts': safe_int(stat_dict.get('strikeOuts', 0)),
                    'walks': walks,
                    'hitsAllowed': hits,
                    'homeRunsAllowed': safe_int(stat_dict.get('homeRuns', 0)),
                    'gamesStarted': safe_int(stat_dict.get('gamesStarted', 0)),
                    'games': safe_int(stat_dict.get('gamesPlayed', 0)),
                    'whip': whip,
                })
            else:
                seasons.append({
                    'position': position,
                    'year': year,
                    'hits': safe_int(stat_dict.get('hits', 0)),
                    'doubles': safe_int(stat_dict.get('doubles', 0)),
                    'triples': safe_int(stat_dict.get('triples', 0)),
                    'homeRuns': safe_int(stat_dict.get('homeRuns', 0)),
                    'rbis': safe_int(stat_dict.get('rbi', 0)),
                    'walks': safe_int(stat_dict.get('baseOnBalls', 0)),
                    'avg': safe_float(stat_dict.get('avg', 0.0)),
                    'obp': safe_float(stat_dict.get('obp', 0.0)),
                    'slg': safe_float(stat_dict.get('slg', 0.0)),
                    'games': safe_int(stat_dict.get('gamesPlayed', 0)),
                    'atBats': safe_int(stat_dict.get('atBats', 0)),
                })

        if len(seasons) == 0:
            return {"error": f"No season statistics found for player '{player_name}'"}

        seasons.sort(key=lambda x: x['year'])

        first_name = stats_data.get('first_name', '')
        last_name = stats_data.get('last_name', '')
        full_name = f"{first_name} {last_name}".strip()

        return {
            'playerName': full_name if full_name else player_name,
            'playerId': player_id,
            'position': position,
            'seasons': seasons,
        }
    except Exception as e:
        logger.exception("Error retrieving player season stats for %s", player_name)
        return {"error": f"Failed to retrieve stats for '{player_name}'"}


def get_team(team_id: int) -> Dict[str, Any]:
    return statsapi.get('team', {'teamId': team_id})


def get_standings(league_id: int = 103) -> Dict[str, Any]:
    return statsapi.standings_data(leagueId=league_id)
