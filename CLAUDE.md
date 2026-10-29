# Punchline — notes de projet

Jeu de soirée multi-téléphones façon Limite Limite : le juge pioche une carte à trous, chaque joueur écrit SA réponse (pas de cartes réponses), le juge retourne les réponses une par une puis choisit la meilleure.

Deuxième jeu dans la même appli : **Le Verdict** (nom choisi par Naim le 27/10, ex « Qui de nous » ; code interne `qui`). L'accueil demande « À quoi voulez-vous jouer ? » avec deux grandes cartes (nom + 3 points), puis on arrive sur l'accueil du jeu choisi (prénom, code, créer), avec une flèche retour. Le jeu est fixé à la création de la partie (plus de choix dans la salle d'attente). Choix mémorisé dans le navigateur (`pl-game`). Un lien ?c=CODE va directement au formulaire.

Nom de l'appli qui réunit les jeux : **Dawa** (« mettre le dawa », choisi par Naim le 27/10 parmi des mots d'argot du même genre que « Zbeul »). `APP_NAME` dans app.js, `<title>`, manifest. Le dépôt GitHub garde le nom punchline (Naim : pas grave). Icône : proposition A retenue (voir Fichiers).

- En ligne : https://lambda123k.github.io/punchline/ (GitHub Pages, branche `main`, racine)
- Dépôt : github.com/lambda123k/punchline
- Base : projet Supabase `punchline` (id `pjywkbrqtntblxtwqjlj`, région eu-west-3), clé anon dans `app.js`

## Fichiers
- `index.html` — styles (tokens bleu cobalt / crème / encre / orange / or ; rose #e8436b pour le coup de cœur), charge supabase-js 2.45.4 et qrcode-generator 1.4.4 depuis jsDelivr. `app.js?v=N`, `cards.js?v=N`, `qui.js?v=N` et `aveux.js?v=N` : monter N à chaque mise en ligne (cache).
- `APP_VERSION` dans app.js = le N du `?v=N` : à monter ensemble à chaque mise en ligne ; affiché en bas des Paramètres (« Version N ») pour vérifier qu'un téléphone a bien la dernière version.
- `app.js` — toute l'appli (vues en chaînes HTML, rendu par comparaison de HTML pour ne pas casser la saisie). `views` = téléphones, `tvViews` = grand écran.
- `cards.js` — `window.CARD_DECK` : 267 cartes triées par Naim le 25/10 (4 tris), rangées par type (soiree, couple, corps, boulot, quotidien, famille, absurde, souvenirs) ; libellés dans `CARD_TYPES`. En dérive `CARDS` (liste à plat) et `CARD_TYPE` (texte → type). `____` = trou. Plus aucune carte à deux-points ni question.
- `icon-*.png`, `apple-touch-icon.png`, `manifest.json` — icône Dawa choisie par Naim le 27/10 (proposition A) : DA / WA en blanc très gras sur deux lignes, WA en or, fond bleu de l'appli. Source : `design/icones-dawa.html`. Ne pas changer sans lui montrer des options d'abord.
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
- Naim (30/10) trouve moche la petite pastille jaune « X devine · 3 pts » en haut de la devinette (`quiViews.judging`, `.rnd.hotpill`). Maquettes : https://claude.ai/artifact/MCdeiMupMJWR7RRcrogFAD (`design/maquettes-devineur.html`) : A grosse pastille + 3 pièces d'or qui s'éteignent, B bandeau orange penché + médaille « +3 », C prénom en grand + échelle +3 · +2 · +1. En attente de son choix.
- Vues : `quiViews` (téléphones) et `quiTv` (grand écran), choisies dans `render()` quand `room.game === "qui"`.

## Jeu 3 : Les Aveux (en ligne le 28/10/2026, code interne `aveux`)
- Principe proposé par Claude, validé par Naim : une affirmation s'affiche (« J'ai déjà couché le premier soir »). Tout le monde répond en même temps (pas de juge) oui ou non en secret, puis parie sur le nombre de oui. Révélation du total, puis de qui a dit quoi.
- Retour de Naim après une soirée (29/10) : ses amis trouvaient dommage de ne pas voir qui a dit oui (Aveux) ni qui a classé qui (Verdict). Choix A pour les deux (maquettes https://claude.ai/artifact/8ESBLHAeTaY4fHvfDFKGhp, `design/maquettes-reveal.html`) : Aveux → deux camps OUI / NON avec les pastilles et prénoms, affichés à la fin du compteur (`aveuCamps`) ; Verdict → sous le thermomètre du groupe, une ligne par joueur avec son classement du plus au moins (`rankLines`). En ligne v=20.
- Base : la réponse de chacun est dans `aveux_answers` (aucune politique RLS, illisible) jusqu'à `aveu_reveal`, qui la copie dans `aveux_bets.said`. `rooms_phase_hook` (retour en lobby) et `create_room` (parties de plus de 12 h) remettent `said` et `aveux_answers.yes` à null.
- Il a aussi dit que certaines affirmations ne sont pas de vrais aveux (« rater le bus » : ça ne fait pas assez mal à avouer). 2e tri en cours (29/10) : https://claude.ai/artifact/GhF7Xfeau4pdFoPMBhPSBK, collection `atri2` (`aidees2` pour ses idées) : 66 nouvelles (types aici « dans cette pièce », asexe, atrahison, ahonte, adingue ; ids `n…`) + les 94 actuelles à repasser (ids `o…`). Source des nouvelles : à reprendre depuis la page (données dans le HTML).
- Points (Naim, 27/10) : pari exact = 2 points, à 1 près = 1 point.
- Interface choisie par Naim le 27/10 parmi 3 maquettes (https://claude.ai/artifact/RR34NFgrrHFBnDrykpKCe2, source `design/maquettes-aveux.html`) : répondre façon B (carte crème + boutons NON / OUI, la carte penche vers la réponse), parier façon C (− nombre + , démarre à la moitié, « Changer ma réponse »), révélation façon A (gros compteur qui monte de 0 au total, un cran toutes les 0,6 s, puis pastilles de score avec le gain). `aveuxViews` / `aveuxTv` dans app.js, styles `.acard`, `.ayn`, `.astep`, `.ybig`.
- Base : `aveux_bets` (room, round, player, bet) en temps réel, lisible ; `aveux_secret` (room, round, yes) sans aucune politique RLS, donc illisible depuis l'appli : le oui n'est jamais lié au joueur. `rooms.yes` (rempli à la révélation), `rooms.aused` (affirmations déjà sorties). Fonctions `aveu_send(p_code, p_player, p_yes, p_bet)` (une seule fois par manche) et `aveu_reveal(p_code, p_round)` (compte les points, passe en result). `next_round`/`restart_room` vident `yes` (et `aused` au restart).
- Déroulé : `draw` → l'hôte tire l'affirmation (`aveuxDraw`, pondérée par les notes) → `writing` (réponse + pari, même minuteur ; à zéro la réponse en cours part seule) → l'hôte appelle `aveu_reveal` quand tout le monde a parié ou 1 s après la fin du temps → `result`. Robots : oui/non et pari au hasard.
- Affirmations : `aveux.js` (`AVEUX_DECK`, `AVEUX_TYPES` préfixe `a` : asoiree, asexe, aex, ahonte, aboulot, adingue). 98 écrites par Claude le 27/10, triées par Naim (page https://claude.ai/artifact/81fRtNeU9Q77iLTQ9zt3Wv, collection `atri`, idées perso `aidees`) : 94 gardées, 4 jetées (vomi dans un taxi, incruster un mariage, pipi dans la rue, viré d'une boîte). Ici la forme « J'ai déjà… » est voulue. Notation nulle/top et page des notes partagées.
- Test : `node tests/test-aveux.js` (serveur neuf).

## Fluidité (29/10/2026, diagnostic demandé par Naim)
- Réaction immédiate : `local(fn)` applique le changement chez soi avant la réponse du serveur (lancer, garder la carte, envoyer une réponse / un classement / un pari, retourner une carte, changer de phase) ; en cas d'erreur on revient en arrière. Attention à calculer les valeurs (ex. `round + 1`) avant `local`, sinon elles sont comptées deux fois. Bouton en cours : `data-busy` (enfoncé, pas grisé).
- Rendu partiel : `render()` dessine l'écran en entier seulement quand `screenKey()` change (jeu, phase, manche) ; sinon `morph()` ne modifie que ce qui a changé, donc les animations `.pop` ne se rejouent plus à chaque événement.
- Requêtes : `refresh()` ne charge que les tables du jeu en cours (réactions seulement au résultat / à la fin de Punchline). Rafraîchissement de secours toutes les 3 s seulement si le temps réel n'est pas connecté, sinon toutes les 15 s.
- `sw.js` (service worker) : page réseau d'abord (cache si plus de 2,5 s), scripts / polices / libs en cache puis mis à jour en arrière-plan ; Supabase jamais en cache. Changer `CACHE` si la stratégie change. Les tests Playwright bloquent le service worker (`serviceWorkers: "block"`).

## Peps (29/10/2026)
- Naim trouve que l'appli manque de peps. Maquettes de 3 directions : https://claude.ai/artifact/K8J8XTMbs8V6pfqZTWddz3 (`design/maquettes-peps.html`) : A un univers par jeu (Punchline noir et or, Verdict dégradé chaud-froid, Aveux violet et rose néon), B plateau télé (bleu gardé, rayons, bandeau qui défile, joueurs qui tombent, compte à rebours 3-2-1, confettis, points qui défilent), C autocollants (fond clair, contours noirs, cartes penchées). Naim (29/10) : il garde A (un univers par jeu) mais trouve l'univers noir de Punchline trop sombre, pas assez joli. 3 ambiances claires pour Punchline : https://claude.ai/artifact/YAMTvjwAXHCuKPko2wJ3Jf (`design/maquettes-punchline-univers.html`) : 1 Corail (rouge corail + rayons + jaune doré, carte crème), 2 Soleil (jaune vif à petits points, carte noire, boutons orange), 3 Bonbon (dégradé mandarine vers rose, bulles, cartes blanches). En attente de son choix. Aussi prévu : remettre Punchline au style des pastilles.

- Choix final de Naim (30/10) : il préfère garder le bleu partout (« j'aimais bien le côté bleu, juste rajouter du peps »), donc direction B plateau télé, sans changer les couleurs ni donner un univers par jeu. Pas de bandeau texte qui défile (pas de texte dans l'appli). En ligne v=22 :
  - rayons en fond retirés le 30/10 (Naim : « kitsch »), fond bleu uni comme avant, y compris derrière le compte à rebours ; bandeau « Manche N » qui traverse l'écran au début de chaque manche (`roundBanner`) ;
  - compte à rebours 3-2-1 géant avant chaque résultat des 3 jeux (`countdown`, 2,1 s, `cdUntil` retarde le compteur des Aveux), puis confettis (`confetti`, plus gros pour le gagnant et le grand écran) et points qui montent dans les pastilles (`countUp`, attributs `data-from` / `data-to` de `scoreChips`) ; double confettis à la fin de partie. Le tout déclenché par `fxOnScreen()` quand l'écran change (marche aussi avec les changements locaux) ; les sons de victoire y sont joués, plus dans `soundsFor` ;
  - Punchline remis au style des pastilles : salle d'attente en pastilles qui tombent avec places vides en pointillés jusqu'à 3 (`crowd`, partagée par les 3 jeux et le grand écran), scores en `scoreChips`, juge en grosse pastille, bandeau penché « Et le gagnant est… » (`wbanner`) avec la pastille du gagnant ;
  - tout est coupé si le téléphone demande moins d'animations.

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
NODE_PATH=/opt/npm-tools/node_modules node tests/test-aveux.js  # Les Aveux (serveur neuf)
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

