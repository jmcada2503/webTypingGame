# Web Typing Game

A two-player typing duel in the browser, rendered as ASCII-shaded 3D. Each player defends their ship by typing incoming words and attacks by typing their own word.

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
