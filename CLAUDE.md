# Punchline — notes de projet

Jeu de soirée multi-téléphones façon Limite Limite : le juge pioche une carte à trous, chaque joueur écrit SA réponse (pas de cartes réponses), le juge retourne les réponses une par une puis choisit la meilleure.

- En ligne : https://lambda123k.github.io/punchline/ (GitHub Pages, branche `main`, racine)
- Dépôt : github.com/lambda123k/punchline
- Base : projet Supabase `punchline` (id `pjywkbrqtntblxtwqjlj`, région eu-west-3), clé anon dans `app.js`

## Fichiers
- `index.html` — styles (tokens bleu cobalt / crème / encre / orange / or ; rose #e8436b pour le coup de cœur), charge supabase-js 2.45.4 et qrcode-generator 1.4.4 depuis jsDelivr. `app.js?v=N` et `cards.js?v=N` : monter N à chaque mise en ligne (cache).
- `app.js` — toute l'appli (vues en chaînes HTML, rendu par comparaison de HTML pour ne pas casser la saisie). `views` = téléphones, `tvViews` = grand écran.
- `cards.js` — `window.CARD_DECK` : cartes rangées par type (famille, couple, medias, societe, quotidien, absurde ; libellés dans `CARD_TYPES`). En dérive `CARDS` (liste à plat) et `CARD_TYPE` (texte → type). `____` = trou ; carte sans trou = question.
- `icon-*.png`, `apple-touch-icon.png`, `manifest.json` — icône choisie par Naim : PUNCH / LINE en blanc très gras, P et L en jaune, fond bleu de l'appli. Ne pas changer sans lui montrer des options d'abord.
- `tests/` — faux backend local + partie complète Playwright (voir Tests).

## Données (Supabase)
- `rooms` (code 4 chiffres PK, host, phase lobby|draw|writing|judging|result|end, round, judge, card, used int[], target, mode (inutilisé), winner, fav (réponse coup de cœur), timer s (0 = illimité), deadline, revealed)
- `players` (id uuid client, room, name, score, seat, last_seen)
- `answers` (room, round, player, text) unique (room, round, player)
- `votes` (room, round, voter, answer) unique (room, round, voter) — vote coup de cœur, modifiable
- `card_ratings` (card texte, player, rating -1|1, type, room) PK (card, player) ; vue `card_scores` (card, type, up, down)
- RLS ouverte à anon (jeu sans compte) : lecture, update rooms, insert/update answers/votes/card_ratings, delete players
- Fonctions : `create_room`, `join_room`, `pick_winner` (+1 au gagnant, +1 bonus à la réponse la plus votée s'il n'y a pas d'ex aequo ; votes du juge et pour soi ignorés), `next_round` (le gagnant devient juge s'il est présent, sinon joueur présent suivant), `restart_room`, `ping(p_player, p_room)` (met à jour last_seen, renvoie l'heure serveur), `is_present(players)` (robot ou vu il y a < 45 s)
- Trigger `rooms_phase_hook` : fixe `deadline` côté serveur à l'entrée en phase writing, remet `revealed` à 0 en judging
- Temps réel : postgres_changes sur rooms/players/answers/votes + broadcast `react` (réactions, rien en base) + rafraîchissement de secours toutes les 3 s. Les mises à jour de `last_seen` seules sont appliquées sans recharger.
- Les migrations contenant `delete` sont annulées par l'outil Supabase (confirmation non reçue) : écrire du SQL sans DELETE, ou demander à Naim de le passer dans l'éditeur SQL. Salle de test « 7209 » restée en base.

## Règles en place
- 3 joueurs présents minimum ; robots (`id` commençant par `b07b07b0-`) ajoutables par l'hôte pour tester seul, pilotés par le téléphone de l'hôte (ils répondent, votent, réagissent, jugent)
- « Hôte » = premier vrai joueur présent (par ordre d'arrivée) : si l'hôte part, le suivant prend le relais
- Temps de réponse : 15 s / 30 s / 1 min / sans limite ; à zéro la réponse en cours part seule. Horloge calée sur le serveur via `ping`.
- Réponses face cachée, le juge les retourne une par une, choix possible seulement quand tout est retourné
- Coup de cœur : pendant la lecture, les autres votent (pas pour leur propre réponse) ; affiché au résultat
- Réactions 😂 💀 🔥 dès la 1re carte retournée et au résultat, sur tous les écrans
- Sons (Web Audio, bouton 🔊/🔇 en haut, mémorisé) et vibrations (Android ; l'iPhone ne vibre pas depuis le web) : nouvelle carte, retournement, 5 dernières secondes, victoire
- Notation des cartes au résultat (👎 Nulle / 👍 Top) ; à la pioche, poids = (top+1)/(nulle+1) borné entre 0,15 et 4. Page « Quelles cartes plaisent ? » depuis l'accueil : % top par type, meilleures / pires cartes.
- Grand écran : accueil → « Grand écran » + code (ou `?tv=CODE`), bouton « Lancer l'affichage » (débloque le son, plein écran). Ne compte pas comme joueur.
- Absents : sans ping depuis 45 s → « Parti », on ne l'attend plus pour écrire ; s'il est juge, l'hôte relance une manche avec un autre juge ; retiré de la partie après 5 min. Revient dès qu'il rouvre l'appli (avant 5 min).

## Tests
Le bac à sable n'atteint ni Supabase ni GitHub Pages, et npm ne peut rien installer. Partie complète (3 téléphones + grand écran) contre un faux backend qui reproduit les fonctions SQL :
```
node tests/mock-server.js /home/claude/punchline 8787 &
NODE_PATH=/opt/npm-tools/node_modules node tests/test.js
```
(Le test remplace supabase-js par `tests/mock-client.js` et le QR par un carré. Un serveur garde son état : en relancer un neuf pour chaque passage. Penser à garder `mock-server.js` aligné avec le SQL.) La logique SQL se teste avec `execute_sql` dans une transaction annulée : insertions en rôle postgres, puis `set local role anon` pour appeler les fonctions.

## Fait le 24/10/2026
Améliorations 1 à 6 de la liste ci-dessous en ligne (version v=4).

## Prochaines étapes choisies par Naim (24/10/2026)
1. ✅ Vote « coup de cœur » du public
2. ✅ Réactions en direct
3. ✅ Sons et vibrations
4. ✅ Notation des cartes + types de cartes + page de stats
5. ✅ Mode grand écran
6. ✅ Retrait automatique d'un joueur parti
7. Ajouter beaucoup plus de cartes, en choisissant le style ensemble (à faire : lui proposer des tons avec exemples, il choisit, puis écrire par types dans `CARD_DECK`)
Écarté : le best-of de fin de soirée.

## Façon de travailler avec Naim
- Pour tout ce qui est visuel (icône, design), montrer plusieurs options et attendre son choix avant de mettre en ligne.
- Il veut des liens directs cliquables avec quoi faire sur chaque page pour les réglages.
