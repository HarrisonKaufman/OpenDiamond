import datetime
import json
import logging
import urllib.request
from typing import Any, Dict, Optional

import requests
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
    try:
        search_season = datetime.date.today().year
        try:
            sports_players = statsapi.get('sports_players', {'season': search_season, 'gameType': 'W'})
            for person in sports_players['people']:
                if person['fullName'].lower() == player_name.lower():
                    logger.info(f"Found {player_name} in active roster")
                    return {
                        'id': person['id'],
                        'fullName': person['fullName'],
                        'primaryPosition': _extract_position(person),
                    }
        except Exception as e:
            logger.debug(f"sports_players lookup failed: {str(e)}")

        try:
            encoded_name = urllib.request.quote(player_name.strip())
            url = f'https://statsapi.mlb.com/api/v1/people/search?names={encoded_name}&sportIds=1'
            resp = requests.get(url, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            
            people = data.get('people', [])
            if people:
                person = people[0]
                logger.info(f"Found {player_name} via search: ID {person.get('id')}")
                return {
                    'id': person.get('id'),
                    'fullName': person.get('fullName'),
                    'primaryPosition': _extract_position(person),
                }
        except Exception as e:
            logger.warning(f"Search API failed for {player_name}: {str(e)}")

        logger.warning(f"Player '{player_name}' not found")
        return None
        
    except Exception as e:
        logger.exception(f"Unexpected error in _search_player for '{player_name}'")
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


def get_mlb_teams() -> Dict[str, Any]:
    try:
        logger.info("Fetching MLB teams list")
        teams_data = statsapi.get('teams', {})
        teams = []
        for team in teams_data.get('teams', []):
            league_name = team.get('league', {}).get('name', '')
            if league_name in ['American League', 'National League']:
                teams.append({
                    'id': team.get('id'),
                    'name': team.get('name'),
                    'abbreviation': team.get('abbreviation'),
                    'teamName': team.get('teamName'),
                    'locationName': team.get('locationName'),
                })
        logger.info(f"Successfully retrieved {len(teams)} MLB teams")
        return {'teams': teams}
    except Exception as e:
        logger.exception("Error retrieving MLB teams")
        return {"error": f"Failed to retrieve teams: {str(e)}"}


def get_teams() -> Dict[str, Any]:
    return get_mlb_teams()


def get_team_roster(team_id: int, season: Optional[int] = None) -> Dict[str, Any]:
    try:
        if season is None:
            season = datetime.date.today().year
        
        logger.info(f"Fetching roster for team {team_id}, season {season}")
        roster_data = statsapi.get('team_roster', {'teamId': team_id, 'season': season})
        
        if 'roster' not in roster_data:
            return {"error": "No roster data found", "roster": []}
        
        roster = []
        for player in roster_data.get('roster', []):
            person = player.get('person', {})
            player_id = person.get('id')
            position = player.get('position', {}).get('abbreviation', 'Unknown')
            
            roster.append({
                'playerId': player_id,
                'fullName': person.get('fullName'),
                'position': position,
                'jerseyNumber': player.get('jerseyNumber'),
                'status': player.get('status', {}).get('code'),
            })
        
        logger.info(f"Successfully retrieved {len(roster)} players for team {team_id}")
        return {'roster': roster}
    except Exception as e:
        logger.exception("Error retrieving team roster for team %s", team_id)
        return {"error": f"Failed to retrieve roster: {str(e)}", "roster": []}


def _get_team_stat_from_group(team_id: int, group: str, season: Optional[int] = None) -> Dict[str, Any]:
    try:
        if season is None:
            season = datetime.date.today().year
        
        all_team_stats = statsapi.get('teams_stats', {
            'season': season,
            'group': group,
            'stats': 'season'
        })
        
        if 'stats' in all_team_stats and all_team_stats['stats']:
            for split in all_team_stats['stats'][0].get('splits', []):
                team = split.get('team', {})
                if team.get('id') == team_id:
                    stat_data = split.get('stat', {})
                    if stat_data:
                        return stat_data
        
        return {}
    except Exception as e:
        logger.debug("Error getting %s stats for team %s: %s", group, team_id, str(e))
        return {}




def _calculate_team_pitching_stats(team_id: int, season: Optional[int] = None) -> Dict[str, Any]:
    try:
        if season is None:
            season = datetime.date.today().year
        
        stats_data = _get_team_stat_from_group(team_id, 'pitching', season)
        
        if stats_data:
            era = safe_float(stats_data.get('era', 0.0))
            if era == 0.0:
                earned_runs = safe_int(stats_data.get('earnedRuns', 0))
                innings_pitched = safe_float(stats_data.get('inningsPitched', 0.0))
                if innings_pitched > 0:
                    era = (earned_runs * 9) / innings_pitched
            
            whip = safe_float(stats_data.get('whip', 0.0))
            if whip == 0.0:
                walks = safe_int(stats_data.get('baseOnBalls', 0))
                hits = safe_int(stats_data.get('hits', 0))
                innings_pitched = safe_float(stats_data.get('inningsPitched', 0.0))
                if innings_pitched > 0:
                    whip = (walks + hits) / innings_pitched
            
            return {
                'era': era,
                'whip': whip,
                'strikeOuts': safe_int(stats_data.get('strikeOuts', 0)),
                'walks': safe_int(stats_data.get('baseOnBalls', 0)),
                'hits': safe_int(stats_data.get('hits', 0)),
                'homeRuns': safe_int(stats_data.get('homeRuns', 0)),
                'wins': safe_int(stats_data.get('wins', 0)),
                'losses': safe_int(stats_data.get('losses', 0)),
                'saves': safe_int(stats_data.get('saves', 0)),
                'inningsPitched': safe_float(stats_data.get('inningsPitched', 0.0)),
                'completeGames': safe_int(stats_data.get('completeGames', 0)),
                'shutouts': safe_int(stats_data.get('shutouts', 0)),
            }
        
        return {}
    except Exception as e:
        logger.debug("Error calculating team pitching stats for team %s: %s", team_id, str(e))
        return {}


def _separate_roster_by_type(roster: list) -> Dict[str, list]:
    position_players = []
    starting_pitchers = []
    relief_pitchers = []
    
    for player in roster:
        if player.get('position') == 'P':
            relief_pitchers.append(player)
        else:
            position_players.append(player)
    
    return {
        'positionPlayers': position_players,
        'startingPitchers': starting_pitchers,
        'reliefPitchers': relief_pitchers,
    }


def get_team_data(team_id: int, season: Optional[int] = None) -> Dict[str, Any]:
    try:
        if season is None:
            season = datetime.date.today().year
        
        logger.info(f"Fetching comprehensive data for team {team_id}, season {season}")
        
        team_info = statsapi.get('team', {'teamId': team_id})
        team_detail = team_info.get('teams', [{}])[0]
        
        roster_response = get_team_roster(team_id, season)
        if 'error' in roster_response:
            roster = []
        else:
            roster = roster_response.get('roster', [])
        
        pitching_stats = {}
        hitting_stats = {}
        try:
            stats_data_pitching = _get_team_stat_from_group(team_id, 'pitching', season)
            stats_data_hitting = _get_team_stat_from_group(team_id, 'hitting', season)
            
            if stats_data_pitching:
                era = safe_float(stats_data_pitching.get('era'))
                if not era or era == 0.0:
                    earned_runs = safe_int(stats_data_pitching.get('earnedRuns', 0))
                    innings_pitched = safe_float(stats_data_pitching.get('inningsPitched', 0.0))
                    if innings_pitched > 0:
                        era = (earned_runs * 9) / innings_pitched
                    else:
                        era = 0.0
                else:
                    era = safe_float(era)
                
                whip = safe_float(stats_data_pitching.get('whip'))
                if not whip or whip == 0.0:
                    walks = safe_int(stats_data_pitching.get('baseOnBalls', 0))
                    hits = safe_int(stats_data_pitching.get('hits', 0))
                    innings_pitched = safe_float(stats_data_pitching.get('inningsPitched', 0.0))
                    if innings_pitched > 0:
                        whip = (walks + hits) / innings_pitched
                    else:
                        whip = 0.0
                else:
                    whip = safe_float(whip)
                
                pitching_stats = {
                    'era': era,
                    'whip': whip,
                    'strikeOuts': safe_int(stats_data_pitching.get('strikeOuts', 0)),
                    'walks': safe_int(stats_data_pitching.get('baseOnBalls', 0)),
                    'hits': safe_int(stats_data_pitching.get('hits', 0)),
                    'homeRuns': safe_int(stats_data_pitching.get('homeRuns', 0)),
                    'wins': safe_int(stats_data_pitching.get('wins', 0)),
                    'losses': safe_int(stats_data_pitching.get('losses', 0)),
                    'saves': safe_int(stats_data_pitching.get('saves', 0)),
                    'shutouts': safe_int(stats_data_pitching.get('shutouts', 0)),
                }
            
            if stats_data_hitting:
                hitting_stats = {
                    'avg': safe_float(stats_data_hitting.get('avg', 0.0)),
                    'obp': safe_float(stats_data_hitting.get('obp', 0.0)),
                    'slg': safe_float(stats_data_hitting.get('slg', 0.0)),
                    'runs': safe_int(stats_data_hitting.get('runs', 0)),
                    'hits': safe_int(stats_data_hitting.get('hits', 0)),
                    'homeRuns': safe_int(stats_data_hitting.get('homeRuns', 0)),
                    'rbis': safe_int(stats_data_hitting.get('rbi', 0)),
                }
        except Exception as e:
            logger.debug(f"Error getting stats for team {team_id}: {str(e)}")
        
        standings = {}
        try:
            stand_data = statsapi.standings_data(leagueId='103,104', season=season)
            for div_id, div_data in stand_data.items():
                for team in div_data.get('teams', []):
                    if safe_int(team.get('team_id')) == team_id:
                        wins = safe_int(team.get('w', 0))
                        losses = safe_int(team.get('l', 0))
                        win_pct = wins / (wins + losses) if (wins + losses) > 0 else 0.0
                        standings = {
                            'wins': wins,
                            'losses': losses,
                            'winPct': round(win_pct, 3),
                            'gamesBack': team.get('gb', 'N/A'),
                        }
                        logger.info(f"Found standings for team {team_id}, season {season}: {standings}")
                        break
        except Exception as e:
            logger.debug(f"Error getting standings for team {team_id}, season {season}: {str(e)}")
        
        logger.info(f"Successfully retrieved all data for team {team_id}")
        return {
            'teamId': team_id,
            'name': team_detail.get('name'),
            'abbreviation': team_detail.get('abbreviation'),
            'teamName': team_detail.get('teamName'),
            'locationName': team_detail.get('locationName'),
            'season': season,
            'standings': standings,
            'pitchingStats': pitching_stats,
            'hittingStats': hitting_stats,
            'roster': roster,
        }
    except Exception as e:
        logger.exception("Error retrieving team data for team %s", team_id)
        return {"error": f"Failed to retrieve team data: {str(e)}"}




def get_team_years(team_id: int) -> Dict[str, Any]:
    try:
        logger.info(f"Fetching available years for team {team_id}")
        
        current_year = datetime.date.today().year
        
        founding_year = 1900
        try:
            team_info = statsapi.get('team', {'teamId': team_id})
            if not team_info.get('teams'):
                return {"error": f"Team {team_id} not found"}
            
            first_year_str = team_info['teams'][0].get('firstYearOfPlay', '')
            if first_year_str:
                try:
                    founding_year = int(first_year_str)
                except ValueError:
                    founding_year = 1900
        except Exception as e:
            logger.debug(f"Could not get team info: {str(e)}")
        
        years = list(range(founding_year, current_year + 1))
        sorted_years = sorted(years, reverse=True)
        
        logger.info(f"Found {len(sorted_years)} years for team {team_id} (founding: {founding_year}, current: {current_year})")
        return {'years': sorted_years}
    except Exception as e:
        logger.exception("Error retrieving years for team %s", team_id)
        return {"error": f"Failed to retrieve years: {str(e)}"}


def get_team_history(team_id: int) -> Dict[str, Any]:
    try:
        logger.info(f"Fetching franchise history for team {team_id}")
        
        history = []
        current_year = datetime.date.today().year
        
        founding_year = 1900
        try:
            team_info = statsapi.get('team', {'teamId': team_id})
            if team_info.get('teams'):
                first_year_str = team_info['teams'][0].get('firstYearOfPlay', '')
                if first_year_str:
                    try:
                        founding_year = int(first_year_str)
                    except ValueError:
                        founding_year = 1900
        except Exception as e:
            logger.debug(f"Could not get team info: {str(e)}")
        
        # Get standings for current year
        try:
            stand_data = statsapi.standings_data(leagueId='103,104')
            for div_id, div_data in stand_data.items():
                for team in div_data.get('teams', []):
                    if safe_int(team.get('team_id')) == team_id:
                        current_year_wins = safe_int(team.get('w', 0))
                        history.append({
                            'year': current_year,
                            'wins': current_year_wins,
                        })
                        break
        except Exception as e:
            logger.debug(f"Could not get current year wins: {str(e)}")
            history.append({
                'year': current_year,
                'wins': 0,
            })
        
        history_dict = {h['year']: h['wins'] for h in history}
        
        for year in range(founding_year, current_year):
            if year not in history_dict:
                try:
                    stand_data = statsapi.standings_data(leagueId='103,104', season=year)
                    
                    for div_id, div_data in stand_data.items():
                        for team in div_data.get('teams', []):
                            if safe_int(team.get('team_id')) == team_id:
                                wins = safe_int(team.get('w', 0))
                                history.append({
                                    'year': year,
                                    'wins': wins,
                                })
                                history_dict[year] = wins
                                break
                        if year in history_dict:
                            break
                except Exception:
                    pass
        
        history.sort(key=lambda x: x['year'])
        
        logger.info(f"Retrieved {len(history)} seasons for team {team_id} (from {founding_year})")
        
        return {
            'teamId': team_id,
            'history': history if history else [{'year': current_year, 'wins': 0}]
        }
    except Exception as e:
        logger.exception("Error retrieving franchise history for team %s", team_id)
        return {"error": f"Failed to retrieve franchise history: {str(e)}"}
