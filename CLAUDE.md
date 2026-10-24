# Punchline — notes de projet

Jeu de soirée multi-téléphones façon Limite Limite : le juge pioche une carte à trous, chaque joueur écrit SA réponse (pas de cartes réponses), le juge retourne les réponses une par une puis choisit la meilleure.

- En ligne : https://lambda123k.github.io/punchline/ (GitHub Pages, branche `main`, racine)
- Dépôt : github.com/lambda123k/punchline
- Base : projet Supabase `punchline` (id `pjywkbrqtntblxtwqjlj`, région eu-west-3), clé anon dans `app.js`

## Fichiers
- `index.html` — styles (tokens bleu cobalt / crème / encre / orange / or), charge supabase-js 2.45.4 et qrcode-generator 1.4.4 depuis jsDelivr
- `app.js` — toute l'appli (vues en chaînes HTML, rendu par comparaison de HTML pour ne pas casser la saisie)
- `cards.js` — `window.CARDS` : 200 cartes sobres. `____` = trou ; carte sans trou = question (la réponse s'affiche après)
- `icon-*.png`, `apple-touch-icon.png`, `manifest.json` — icône choisie par Naim : PUNCH / LINE en blanc très gras, P et L en jaune, fond bleu de l'appli. Ne pas changer sans lui montrer des options d'abord.

## Données (Supabase)
- `rooms` (code 4 chiffres PK, host, phase lobby|draw|writing|judging|result|end, round, judge, card, used int[], target, mode (inutilisé), winner, timer s (0 = illimité), deadline, revealed)
- `players` (id uuid client, room, name, score, seat)
- `answers` (room, round, player, text) unique (room, round, player)
- RLS ouverte à anon (jeu sans compte) : lecture, update rooms, insert/update answers, delete players
- Fonctions : `create_room`, `join_room`, `pick_winner`, `next_round` (le gagnant devient juge, sinon ordre d'arrivée), `restart_room`
- Trigger `rooms_phase_hook` : fixe `deadline` côté serveur à l'entrée en phase writing, remet `revealed` à 0 en judging
- Temps réel : postgres_changes sur les 3 tables + rafraîchissement de secours toutes les 3 s
- Les migrations contenant `delete` sont annulées par l'outil Supabase (confirmation non reçue) : écrire du SQL sans DELETE, ou demander à Naim de le passer dans l'éditeur SQL. Salle de test « 7209 » restée en base.

## Règles en place
- 3 joueurs minimum ; robots (`id` commençant par `b07b07b0-`) ajoutables par l'hôte pour tester seul, pilotés par le téléphone de l'hôte
- Temps de réponse : 15 s / 30 s / 1 min / sans limite ; à zéro la réponse en cours part seule
- Réponses face cachée, le juge les retourne une par une, choix possible seulement quand tout est retourné

## Tests
Le bac à sable n'atteint ni Supabase ni GitHub Pages : on teste avec Playwright contre un faux backend local qui reproduit les fonctions SQL (scripts dans le scratchpad de la session : `test.js`, `mock-client.js`, `solo.js`, `timer-test.js`). La logique SQL se teste avec `execute_sql` (en `set local role anon` dans une transaction annulée).

## Prochaines étapes choisies par Naim (24/10/2026)
1. Vote « coup de cœur » du public pendant que le juge choisit (pas pour sa propre carte), point bonus pour la plus votée
2. Réactions en direct (😂 💀 🔥) visibles sur tous les écrans pendant la lecture
3. Sons et vibrations (retournement, 5 dernières secondes, victoire)
4. Notation des cartes : « carte nulle » / « carte top » par les joueurs → une sorte d'algorithme : les cartes bien notées sortent plus souvent, les mal notées moins ; idéalement classer les cartes par type pour comprendre quel genre plaît et en écrire davantage
5. Mode grand écran (télé / ordi affiche carte, compte à rebours, réponses ; les téléphones servent à écrire)
6. Retrait automatique d'un joueur parti (inactif) pour ne pas bloquer les manches
7. Ajouter beaucoup plus de cartes, en choisissant le style ensemble
Écarté : le best-of de fin de soirée.

## Façon de travailler avec Naim
- Pour tout ce qui est visuel (icône, design), montrer plusieurs options et attendre son choix avant de mettre en ligne.
- Il veut des liens directs cliquables avec quoi faire sur chaque page pour les réglages.
