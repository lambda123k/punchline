// Dilemmes du jeu « Le Dilemme » : rouge ou bleu en secret, puis chacun devine au curseur le % du groupe qui a pris bleu.
// 01/11 : 82 écrits par Claude, mis en ligne directement à la demande de Naim (tri possible sur https://claude.ai/artifact/Ji5RQg9gTTEyZ54FgW8H1z, collection dtri).
// Chaque dilemme est stocké dans rooms.card sous la forme « rouge\nbleu ».
window.DIL_TYPES = {
 "dsexe": "Dilemme · sexe",
 "dcouple": "Dilemme · amour & ex",
 "dici": "Dilemme · dans cette pièce",
 "dsoiree": "Dilemme · soirées & alcool",
 "ddegueu": "Dilemme · dégueu",
 "dargent": "Dilemme · argent",
 "ddingue": "Dilemme · absurde",
 "dvie": "Dilemme · choix de vie"
};
window.DIL_DECK = {
 "dsexe": [
["Ne plus jamais faire l'amour", "Ne plus jamais boire une goutte d'alcool"],
["Recoucher une dernière fois avec ton pire ex", "Ne coucher avec personne pendant deux ans"],
["Faire l'amour toute ta vie dans le noir total", "Toute ta vie avec la lumière à fond"],
["Être nul au lit sans jamais le savoir", "Être un dieu au lit mais que personne ne veuille de toi"],
["Que ton partenaire crie le prénom de ton meilleur pote pendant l'amour", "Qu'il éclate de rire au pire moment"],
["Avoir un orgasme à chaque éternuement", "Ne plus jamais avoir d'orgasme"],
["Qu'un porno amateur de toi sorte sous ton vrai nom", "Faire un strip-tease ce soir devant tout le monde ici"],
["Coucher avec quelqu'un de très moche qui est un dieu au lit", "Avec quelqu'un de magnifique qui est une catastrophe"],
["Que tous tes ex te notent sur internet", "Que ta prochaine relation lise tous tes anciens sextos"],
["Ne plus jamais pouvoir embrasser avec la langue", "Ne plus jamais avoir de préliminaires"],
["Que ton dernier nude passe sur l'écran géant d'un stade", "Envoyer ton dernier nude à ton patron"],
["Faire l'amour une seule fois par an mais incroyable", "Tous les jours mais toujours moyen"]
],
 "dcouple": [
["Lire tous les messages de ton partenaire", "Qu'il lise tous les tiens"],
["Savoir que ton partenaire t'a trompé une fois il y a longtemps", "Ne jamais le savoir"],
["Te marier avec ton ex", "Rester célibataire à vie"],
["Que ton couple soit filmé façon téléréalité", "Ne jamais pouvoir t'embrasser en public"],
["Sortir avec quelqu'un qui ronfle comme un tracteur", "Avec quelqu'un qui parle de son ex en dormant"],
["Aimer quelqu'un qui ne t'aime pas", "Être aimé par quelqu'un que tu n'aimes pas"],
["Découvrir que ton couple a commencé sur un pari", "Découvrir que tu étais son plan B"],
["Que ton partenaire ait couché avec ton meilleur pote avant vous", "Avec ton boss"],
["Un partenaire canon mais jaloux maladif", "Un partenaire banal qui te fait mourir de rire"],
["Rester toute ta vie avec ton premier amour", "Ne jamais connaître le grand amour"]
],
 "dici": [
["Embrasser quelqu'un dans cette pièce, tiré au sort", "Lire à voix haute ta dernière recherche Google"],
["Montrer ta galerie photo au groupe pendant 30 secondes", "Donner ton téléphone déverrouillé à ton voisin de gauche 5 minutes"],
["Partir un mois en vacances avec la personne à ta droite", "Avec la personne à ta gauche"],
["Que le groupe choisisse ton prochain tatouage", "Que le groupe choisisse ta prochaine coupe"],
["Dire ce que tu penses vraiment de chaque personne ici", "Ne plus jamais revoir ce groupe"],
["Être en coloc un an avec le plus bordélique ici", "Avec le plus relou ici"],
["Que quelqu'un ici lise ta dernière conversation WhatsApp", "Que quelqu'un ici poste une story sur ton compte"],
["Coucher avec quelqu'un dans cette pièce", "Que tout le monde ici connaisse ton nombre de partenaires"]
],
 "dsoiree": [
["Ne plus jamais boire d'alcool", "Ne plus jamais pouvoir danser"],
["Te réveiller à côté d'un inconnu sans aucun souvenir", "Te réveiller seul dans une ville inconnue sans téléphone"],
["Que chacune de tes soirées soit filmée et diffusée le lendemain", "Ne plus jamais sortir"],
["Avoir la gueule de bois sans avoir bu", "Être bourré dès que tu bois de l'eau"],
["Être toujours le plus bourré de la soirée", "Toujours le seul à jeun"],
["Faire la fête tous les soirs pendant un an", "Ne plus jamais faire la fête"],
["Être celui qui pleure quand il est bourré", "Celui qui veut se battre quand il est bourré"],
["Envoyer un message bourré à ton ex", "À ton patron"],
["Danser seul sur une table au mariage de ton meilleur pote", "Faire son discours de mariage complètement bourré"],
["Ne boire que du vin chaud toute ta vie", "Que de la bière tiède"]
],
 "ddegueu": [
["Lécher la barre du métro", "Boire un verre d'eau de vaisselle"],
["Avoir toujours une crotte de nez visible", "Sentir toujours un peu la transpiration"],
["Péter très fort à chaque fois que tu dis bonjour", "Roter à chaque fois que tu dis merci"],
["Manger un ver de terre vivant", "Manger une cuillère de pâtée pour chat"],
["Ne pas te brosser les dents pendant un an", "Ne pas te laver pendant un an"],
["Avoir des aisselles qui sentent le fromage", "Des pieds qui sentent le poisson"],
["Faire pipi dans ton pantalon à chaque fou rire", "Baver dès que quelqu'un te plaît"],
["Boire un verre de la sueur de quelqu'un ici", "Mâcher le chewing-gum de quelqu'un ici"],
["Avoir la diarrhée pendant ton mariage", "Vomir pendant l'entretien d'embauche de tes rêves"],
["Ne plus jamais utiliser de papier toilette", "Partager ta brosse à dents avec un inconnu"]
],
 "dargent": [
["Gagner un million mais ne plus jamais voir tes potes", "Rester fauché avec eux"],
["500 000 € mais tout le monde voit ton historique internet", "Ne rien gagner"],
["5 000 € par mois sans bosser mais vivre chez tes parents", "2 000 € par mois dans ton propre appart"],
["Gagner au loto mais que tout le monde te déteste", "Être adoré et fauché"],
["Être riche et moche", "Être pauvre et canon"],
["100 000 € mais te raser la tête et les sourcils", "Garder tes sourcils"],
["Doubler ton salaire mais bosser avec ton ex", "Garder ton salaire"],
["Un million tout de suite", "5 000 € par mois à vie"],
["Payer toutes les additions de ce groupe pendant un an", "Ne plus jamais sortir avec eux"],
["50 000 € mais marcher à quatre pattes en public pendant un mois", "Ne rien gagner"]
],
 "ddingue": [
["Avoir des doigts en saucisse", "Des dents en Lego"],
["Ne parler qu'en chantant", "Ne te déplacer qu'à cloche-pied"],
["Parler aux animaux mais ils sont tous méchants", "Comprendre les bébés mais ils ne parlent que de toi"],
["Devenir invisible dès que tu fermes les yeux", "Lire dans les pensées mais seulement les pensées gênantes"],
["Avoir une voix d'hélium toute ta vie", "Avoir un accent que personne ne comprend"],
["Te battre contre 100 canards de la taille d'un chat", "Contre un canard de la taille d'un cheval"],
["Avoir une musique de film à chaque fois que tu entres dans une pièce", "Un rire enregistré après chacune de tes phrases"],
["Sentir l'oignon pour toujours", "Avoir la Macarena dans la tête pour toujours"],
["Être un génie que personne ne croit", "Un idiot que tout le monde écoute"],
["Revivre la même journée pendant un an", "Avancer de dix ans d'un coup"],
["Avoir une queue de chat", "Avoir des oreilles d'âne"],
["Pouvoir voler mais à 5 km/h", "Te téléporter mais tout nu à l'arrivée"],
["Que ton téléphone lise tous tes messages à voix haute", "Que tes pensées s'affichent sur ton front une heure par jour"],
["Ne plus jamais dormir", "Dormir 16 heures par jour"]
],
 "dvie": [
["Connaître la date de ta mort", "Connaître la cause de ta mort"],
["Revenir à tes 15 ans avec ta tête d'aujourd'hui", "Avoir 50 ans demain et être riche"],
["Ne plus jamais avoir de téléphone", "Ne plus jamais voyager"],
["Perdre tous tes souvenirs", "Ne plus pouvoir t'en faire de nouveaux"],
["Être célèbre pour un truc humiliant", "Rester inconnu toute ta vie"],
["Ne plus jamais pouvoir mentir", "Ne jamais savoir quand on te ment"],
["Vivre 200 ans tout seul", "Vivre 50 ans bien entouré"],
["Savoir ce que tout le monde pense vraiment de toi", "Ne jamais le savoir"]
]
};
window.DIL = []; window.DIL_TYPE = {};
Object.keys(window.DIL_DECK).forEach(t => window.DIL_DECK[t].forEach(p => { const q = p[0] + "\n" + p[1]; window.DIL.push(q); window.DIL_TYPE[q] = t; }));
