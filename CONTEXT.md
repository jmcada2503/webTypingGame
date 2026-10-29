# Web Typing Game

A two-player typing game in the browser, played in Matches, rendered as ASCII-shaded 3D. Each player defends their ship by typing incoming words and attacks by typing their own word.

## Language

### Scene

**Cockpit**:
The player's own ship seen from inside: large, bottom center of the screen, holding the readouts and controls.
_Avoid_: Control station, control center, dashboard

**Enemy ship**:
The opponent's ship, seen small in the distance at the top center of the screen.
_Avoid_: Opponent ship, enemy

### Words

**Word bullet**:
A word fired by the enemy ship that travels toward the player, growing and moving down as it approaches. Typing it destroys it; letting it arrive costs a life.
_Avoid_: Bullet word, enemy word, attacking word

**Flight**:
How far a Word bullet has travelled, from leaving the Enemy ship (0) to reaching the Cockpit (1).
_Avoid_: Approach, progress, distance

**Attack word**:
The word the player types to fire at the opponent, shown in red in the Cockpit. Firing it creates a Shot.
_Avoid_: Attacking word, ammo

**Shot**:
An Attack word the player has fired. In the opponent's game it flies as a Word bullet; in the player's game it shows on the Radar until it hits the Enemy ship or the opponent destroys it.
_Avoid_: Blip, outgoing bullet

**Radar**:
The Cockpit screen showing the player's Shots flying toward the Enemy ship.
_Avoid_: Scanner, minimap

**Target**:
A Word bullet whose word starts with the Typed word; its matched letters are highlighted.
_Avoid_: Focused, selected

**Typed word**:
What the player has typed so far, before submitting it.
_Avoid_: Input, buffer, writing

**Pace**:
How fast a player is typing right now: the letters of their correct words (Word bullets destroyed plus Attack words fired) per second, over the last several seconds. A word counts once it's submitted correctly; wrong or unfinished words don't count. Each player has one; the difference between the two drives how the space around the Cockpit moves.
_Avoid_: Speed, WPM, typing rate

**Lives**:
How many word bullets the player can let through before losing; starts at 3.

### Matches

**Match**:
One game between two players, from the end of the Countdown until it ends: one player wins, or it ends in Peace.
_Avoid_: Duel, game, round

**Practice**:
Playing alone: Word bullets come from the game, there's no Attack word and no opponent.
_Avoid_: Single player, training, offline mode

**Public match**:
A Match against a random opponent found by Matchmaking.
_Avoid_: Online match, ranked match, quick match

**Private match**:
A Match against a specific person, joined through an Invite link.
_Avoid_: Custom match, friend match, room

**Invite link**:
The link a player shares so one other person can join their Private match.
_Avoid_: Room code, share link

**Matchmaking**:
Looking for a random opponent for a Public match.
_Avoid_: Queue, lobby, search

**Countdown**:
The 5-second freeze once both players are connected; nobody can act until it ends and the Match starts.
_Avoid_: Warmup, ready check

**Rematch**:
A new Match between the same two players, proposed by one and accepted by the other after a Match ends.
_Avoid_: Revenge, replay

**Idle**:
A player who hasn't pressed a key for a while during a Match.
_Avoid_: AFK, inactive

**Peace**:
A Match that ends with no winner because both players stayed Idle too long.
_Avoid_: Draw, tie, stalemate

**Resting**:
Online play switched off because this month's budget is used up; Practice still works and Matches already running finish normally.
_Avoid_: Offline, down, maintenance
