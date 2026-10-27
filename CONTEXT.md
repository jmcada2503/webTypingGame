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
The word the player types to fire at the opponent, shown in red on the right side of the cockpit. Firing it is not shown as a projectile.
_Avoid_: Attacking word, ammo

**Target**:
A Word bullet whose word starts with the Typed word; its matched letters are highlighted.
_Avoid_: Focused, selected

**Typed word**:
What the player has typed so far, before submitting it.
_Avoid_: Input, buffer, writing

**Lives**:
How many word bullets the player can let through before losing; starts at 3.
