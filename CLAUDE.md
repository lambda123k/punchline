# Punchline — notes de projet

Jeu de soirée multi-téléphones façon Limite Limite : le juge pioche une carte à trous, chaque joueur écrit SA réponse (pas de cartes réponses), le juge retourne les réponses une par une puis choisit la meilleure.

Deuxième jeu dans la même appli : **Le Verdict** (nom choisi par Naim le 27/10, ex « Qui de nous » ; code interne `qui`). L'accueil demande « À quoi voulez-vous jouer ? » avec deux grandes cartes (nom + 3 points), puis on arrive sur l'accueil du jeu choisi (prénom, code, créer), avec une flèche retour. Le jeu est fixé à la création de la partie (plus de choix dans la salle d'attente). Choix mémorisé dans le navigateur (`pl-game`). Un lien ?c=CODE va directement au formulaire.

Nom de l'appli qui réunit les jeux : **Dawa** (« mettre le dawa », choisi par Naim le 27/10 parmi des mots d'argot du même genre que « Zbeul »). `APP_NAME` dans app.js, `<title>`, manifest. Le dépôt GitHub garde le nom punchline (Naim : pas grave). Icône à refaire : 4 propositions dans `design/icones-dawa.html` (A : DA/WA blanc et or sur bleu, façon ancienne icône ; B : dawa noir sur orange ; C : lettres de travers sur bleu ; D : dawa or sur noir avec la bande du thermomètre), attendre son choix puis générer icon-192, icon-512, apple-touch-icon.

- En ligne : https://lambda123k.github.io/punchline/ (GitHub Pages, branche `main`, racine)
- Dépôt : github.com/lambda123k/punchline
- Base : projet Supabase `punchline` (id `pjywkbrqtntblxtwqjlj`, région eu-west-3), clé anon dans `app.js`

## Fichiers
- `index.html` — styles (tokens bleu cobalt / crème / encre / orange / or ; rose #e8436b pour le coup de cœur), charge supabase-js 2.45.4 et qrcode-generator 1.4.4 depuis jsDelivr. `app.js?v=N`, `cards.js?v=N` et `qui.js?v=N` : monter N à chaque mise en ligne (cache).
- `app.js` — toute l'appli (vues en chaînes HTML, rendu par comparaison de HTML pour ne pas casser la saisie). `views` = téléphones, `tvViews` = grand écran.
- `cards.js` — `window.CARD_DECK` : 267 cartes triées par Naim le 25/10 (4 tris), rangées par type (soiree, couple, corps, boulot, quotidien, famille, absurde, souvenirs) ; libellés dans `CARD_TYPES`. En dérive `CARDS` (liste à plat) et `CARD_TYPE` (texte → type). `____` = trou. Plus aucune carte à deux-points ni question.
- `icon-*.png`, `apple-touch-icon.png`, `manifest.json` — icône choisie par Naim : PUNCH / LINE en blanc très gras, P et L en jaune, fond bleu de l'appli. Ne pas changer sans lui montrer des options d'abord.
- `qui.js` — `window.QUI_DECK` : 121 questions « Qui de nous… ? » rangées par type (préfixe `q` : qsoiree, qcouple, qdingue, qcaractere, qquotidien, qargent, qsurvie, qavenir), libellés dans `QUI_TYPES` ; en dérive `QUI` et `QUI_TYPE`. Écrites par Claude le 26/10, triées par Naim le 26/10 (page https://claude.ai/artifact/W3wvvP8YWuaicm5nvrikUE, collection `qtri` ; `qidees` = ses propres questions ; lire avec ArtifactData) : 89 gardées, 7 jetées.
  Règles de Naim : une question sur un acte que personne n'a peut-être fait se dit « Qui de nous est le plus susceptible de… » (pas « a déjà… » ni « ferait… ») ; les traits (« le plus râleur ») restent tels quels. Il aime les énormités en « le plus susceptible d'être… » (acteur porno, détraqué sexuel, zoophile en cachette) : type `qdingue`, 32 questions ajoutées le 26/10, triées sur la même page (version 2, collection `qtri2`) : les 32 gardées. Ce style lui plaît : en écrire d'autres si le paquet s'use. Mêmes limites que pour les cartes (rien de raciste ou homophobe, ni famille/enfants dans un contexte sexuel).
- `tests/` — faux backend local + parties complètes Playwright (voir Tests).

## Données (Supabase)
- `rooms` (code 4 chiffres PK, host, phase lobby|draw|writing|judging|result|end, round, judge, card, used int[], target, mode (inutilisé), winner, fav (réponse coup de cœur), timer s (0 = illimité), deadline, revealed)
- `players` (id uuid client, room, name, score, seat, last_seen)
- `answers` (room, round, player, text) unique (room, round, player)
- `votes` (room, round, voter, answer) unique (room, round, voter) — vote coup de cœur, modifiable
- `card_ratings` (card texte, player, rating -1|1, type, room) PK (card, player) ; vue `card_scores` (card, type, up, down)
- RLS ouverte à anon (jeu sans compte) : lecture, update rooms, insert/update answers/votes/card_ratings, delete players
- Fonctions : `create_room`, `join_room`, `pick_winner` (+1 au gagnant, +1 bonus à la réponse la plus votée s'il n'y a pas d'ex aequo ; votes du juge et pour soi ignorés), `next_round` (le gagnant devient juge s'il est présent, sinon joueur présent suivant), `restart_room`, `ping(p_player, p_room)` (met à jour last_seen, renvoie l'heure serveur), `is_present(players)` (robot ou vu il y a < 45 s)
- Trigger `rooms_phase_hook` : fixe `deadline` et `writing_at` côté serveur à l'entrée en phase writing, remet `revealed` à 0 en judging, et efface le texte des réponses (→ « — ») au retour en `lobby` (Rejouer). Pas à `end` : le récap des insignes a besoin du texte.
- `create_room` efface le texte des réponses des parties inactives depuis 12 h. Demande de Naim : rien ne doit rester stocké. Toute nouvelle migration qui redéfinit `rooms_phase_hook` ou `create_room` doit garder ces effacements.
- Temps réel : postgres_changes sur rooms/players/answers/votes + broadcast `react` (réactions, rien en base) + rafraîchissement de secours toutes les 3 s. Les mises à jour de `last_seen` seules sont appliquées sans recharger.
- Les migrations contenant `delete` sont annulées par l'outil Supabase (confirmation non reçue) : écrire du SQL sans DELETE, ou demander à Naim de le passer dans l'éditeur SQL. Salle de test « 7209 » restée en base.

## Règles en place
- 3 joueurs présents minimum ; robots (`id` commençant par `b07b07b0-`) ajoutables par l'hôte pour tester seul, pilotés par le téléphone de l'hôte (ils répondent, votent, réagissent, jugent)
- « Hôte » = premier vrai joueur présent (par ordre d'arrivée) : si l'hôte part, le suivant prend le relais
- Temps de réponse : 15 s / 30 s / 1 min / sans limite ; à zéro la réponse en cours part seule. Horloge calée sur le serveur via `ping`.
- Pioche : le juge voit d'abord la carte seul sur son téléphone, peut « Piocher une autre carte » autant qu'il veut, puis « Garder cette carte » l'affiche chez tout le monde et lance le temps (demande de Naim, 25/10). Les robots juges piochent directement.
- Réponses face cachée, le juge les retourne une par une, choix possible seulement quand tout est retourné
- Coup de cœur : pendant la lecture, les autres votent (pas pour leur propre réponse) ; affiché au résultat
- Réactions 😂 💀 🔥 dès la 1re carte retournée et au résultat, sur tous les écrans
- Pas d'emojis dans l'interface (Naim n'aime pas), sauf les réactions 😂 💀 🔥 ; icônes dessinées en SVG (`ICON` dans app.js)
- Accueil : roue crantée en haut à droite → Paramètres (son, afficher sur un grand écran, comment jouer, notes des cartes), choisie par Naim plutôt que des boutons sur l'accueil
- Pas de texte d'explication dans l'appli (Naim, 26/10 : « trop moche, pas utile, tout est évident ») : ni phrase d'accroche, ni « comment on joue », ni consignes sous les boutons. Les règles sont dans Paramètres → Comment jouer (`views.help`). Garder les écrans réduits aux boutons, cartes et noms.
- Sons (Web Audio, interrupteur dans Paramètres et icône haut-parleur en haut pendant la partie, mémorisé) et vibrations (Android ; l'iPhone ne vibre pas depuis le web) : nouvelle carte, retournement, 5 dernières secondes, victoire
- Notation des cartes au résultat : discrète (petits liens « nulle / top » en bas), visible seulement par l'hôte (Naim : « c'est plus pour moi ») ; à la pioche, poids = (top+1)/(nulle+1) borné entre 0,15 et 4. Page « Notes des cartes » depuis Paramètres : % top par type, meilleures / pires cartes.
- Grand écran : accueil → Paramètres → « Afficher sur un grand écran » + code (ou `?tv=CODE`), bouton « Lancer l'affichage » (débloque le son, plein écran). Ne compte pas comme joueur.
- Absents : sans ping depuis 45 s → « Parti », on ne l'attend plus pour écrire ; s'il est juge, l'hôte relance une manche avec un autre juge ; retiré de la partie après 5 min. Revient dès qu'il rouvre l'appli (avant 5 min).

## Jeu 2 : Le Verdict, ex « Qui de nous » (26/10/2026, idée de Naim)
- Principe donné par Naim : à chaque manche, un joueur devine. Les autres reçoivent une question secrète (« Qui de nous est le plus fort ? ») et classent tous les joueurs, devineur compris. Le devineur voit tous les classements et doit retrouver la question parmi 4 propositions.
- Base : `rooms.game` ('punchline' | 'qui'), `rooms.options` (4 questions dans l'ordre affiché), `rooms.guess`, `rooms.qused` (questions déjà sorties) ; table `rankings` (room, round, player, ranking uuid[]) unique (room, round, player), en temps réel. Fonction `guess_question(p_code, p_guess)`. `next_round` : en « qui » le devineur tourne (pas de gagnant) ; `next_round`/`restart_room` vident options et guess.
- Phases réutilisées : `draw` (l'hôte tire en silence la question + 3 leurres de types différents, `quiDraw`), `writing` = classement (même minuteur, même trigger), `judging` = devinette, `result`, `end`. Le juge (`rooms.judge`) est le devineur.
- Points (choisis par Naim le 26/10, pour plus de rivalité) : essais dégressifs, le devineur gagne 3 / 2 / 1 point s'il trouve au 1er / 2e / 3e essai (les mauvaises tuiles s'éteignent chez tout le monde, `rooms.wrong text[]`), 0 après 3 erreurs ; « dans le moule » : +1 à chaque classeur dont le n°1 est le n°1 du groupe (meilleure moyenne, ex aequo compris), que le devineur trouve ou non (fonction `qui_moule`, appelée par `guess_question`). Écarté pour l'instant : le point « désigné » pour le joueur classé 1er par le groupe.
- Le devineur et le grand écran ne voient jamais la question avant le résultat. Classement par touches successives (1 = le plus) ; à la fin du temps un classement partiel part complété dans l'ordre d'arrivée. 
- Robots : classent et devinent au hasard. Notation nulle/top des questions et page des notes partagées avec Punchline (types préfixés `q`). Pas d'insignes propres à ce jeu (seul « Le fantôme » peut sortir).
- Interface refaite le 26/10 dans le style B « thermomètre » choisi par Naim (maquettes : https://claude.ai/artifact/S8wqvm8tD8FU7K7akL6Fjm). Il trouvait l'ancienne « dégueulasse, pas ludique » : trop de texte (personne ne lit), tableau de chiffres illisible. Donc : presque pas de texte, une pastille couleur + initiale par joueur (`av`, `avColor` selon l'ordre d'arrivée), classement en touchant les pastilles qui se posent sur une jauge chaud → froid (`rankingGauge`), jauge du groupe placée selon la moyenne avec à droite les pastilles de ceux qui l'ont mis en 1er (`groupGauge`), 4 grosses tuiles de couleur pour deviner (`tiles`), scores en pastilles avec le gain de la manche (`scoreChips`).
- Vues : `quiViews` (téléphones) et `quiTv` (grand écran), choisies dans `render()` quand `room.game === "qui"`.

## Insignes (25/10/2026, choisis par Naim)
- Insignes en médailles rondes colorées (style choisi par Naim, pas les pastilles) : `BADGE_DEF` dans app.js, calcul dans `roundBadges` / `gameBadges`
- Révélés uniquement au classement final (Naim, 25/10 : plus d'annonce en fin de manche, trop chargé). 11 insignes : Doublé, Juge en or, Dernière seconde, Droit au but, En feu, Chouchou du public, Incompris, Gâchette rapide, Le romancier, Faiseur de rires, Le fantôme. « Le critique » retiré avec la notation devenue discrète.
- Données : `answers.won/fav/judge` (remplis par `pick_winner`), `answers.secs/late` (trigger `answers_timing`, depuis `rooms.writing_at`), table `reactions` (réactions liées à la carte lue), `players.ghost` (posé par `ping` au retour d'un absent), `rooms.start_round/started_at` (début de la partie en cours)

## Tests
Le bac à sable n'atteint ni Supabase ni GitHub Pages, et npm ne peut rien installer. Partie complète (3 téléphones + grand écran) contre un faux backend qui reproduit les fonctions SQL :
```
node tests/mock-server.js /home/claude/punchline 8787 &
NODE_PATH=/opt/npm-tools/node_modules node tests/test.js        # Punchline
NODE_PATH=/opt/npm-tools/node_modules node tests/test-qui.js    # Qui de nous (serveur neuf)
```
(Le test remplace supabase-js par `tests/mock-client.js` et le QR par un carré. Un serveur garde son état : en relancer un neuf pour chaque passage. Penser à garder `mock-server.js` aligné avec le SQL.) La logique SQL se teste avec `execute_sql` dans une transaction annulée : insertions en rôle postgres, puis `set local role anon` pour appeler les fonctions.

## Fait le 24/10/2026
Améliorations 1 à 6 en ligne (v=4), puis 100 nouvelles cartes (v=5). Naim trouvait les cartes d'origine nulles : il a choisi les styles « moments vécus », « faux formats » et « trash assumé » (pas « sobre comme avant »). Suivre la page des notes pour voir quel style gagne et écrire davantage dans celui-là.

## Prochaines étapes choisies par Naim (24/10/2026)
1. ✅ Vote « coup de cœur » du public
2. ✅ Réactions en direct
3. ✅ Sons et vibrations
4. ✅ Notation des cartes + types de cartes + page de stats
5. ✅ Mode grand écran
6. ✅ Retrait automatique d'un joueur parti
7. ✅ 100 cartes ajoutées dans les 3 styles choisis. Suite possible : selon les notes, en écrire plus dans le style gagnant et retirer les cartes d'origine mal notées.
Écarté : le best-of de fin de soirée.

## Tri des cartes avec Naim (25/10/2026)
- Page de tri : https://claude.ai/artifact/B2qCzYx9CTuWBhTptKpRmA (base de l'artifact : collection `tri` = 1er tri des 300 cartes, `tri2` = 2e tri de 148 nouvelles cartes + 22 réécrites ; lire avec ArtifactData).
- 1er tri : 93 gardées sur 300. Ses règles : aucune carte avec deux-points ni question, phrases simples et naturelles ; ton de jeunes adultes (20-30 ans), pas de vocabulaire TikTok d'ado, peu d'anglais ; peu de cartes qui parlent de gens (famille) ; trash côté sexe entre adultes, alcool, ex, soirées.
- Limite posée par Claude : pas de cartes conçues pour amener des blagues racistes ou homophobes, ni de famille/enfants dans un contexte sexuel. Naim l'a accepté.
- 2e tri : 138 gardées, 4 jetées, 28 non triées (incluses). Paquet de 237 cartes en ligne (v=9).
- 3e tri (`tri3`) : 30 cartes « entre potes » (prénom dans le trou, clichés de groupe) toutes refusées. Naim : les prénoms seuls c'est nul, et les joueurs ne forment pas forcément un groupe (il peut jouer avec son père).
- 4e tri (`tri4`) : 30 cartes « souvenirs et délires » (« comme la fois où ____ », « et puis ____ ») : toutes gardées, type `souvenirs`, en ligne (v=10). Il accepte que ces cartes se ressemblent un peu, diluées dans le paquet.

## Façon de travailler avec Naim
- Pour tout ce qui est visuel (icône, design), montrer plusieurs options et attendre son choix avant de mettre en ligne.
- Il veut des liens directs cliquables avec quoi faire sur chaque page pour les réglages.
