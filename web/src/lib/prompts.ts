import type { Locale } from "../i18n/locales.ts";

/**
 * The vision model prompt in each app language: the instructions, the
 * category names the model answers with and the reason it writes (shown in
 * the review). The categories are the same in every language — `labels` maps
 * each internal key to the word the model must use. Changing any text here
 * changes the classification: run the prompt evals (web/evals, `npm run
 * eval:prompts`) before and after.
 */

export const SUGGESTIONS = ["cyclists", "kick_scooters", "mopeds", "unicycles", "pedestrians", "cars", "motorcycles", "other", "discarded"] as const;
export type Suggestion = (typeof SUGGESTIONS)[number];

export type Prompt = {
  instructions: string;
  /** internal key → word in the JSON answer (unique, no spaces) */
  labels: Record<Suggestion, string>;
  filmstrip: string;
  context: string;
  noFilmstrip: string;
  /** {label}: the detector's guess */
  detectorHint: string;
  classify: string;
  /** description of the "reason" field in the answer schema */
  reason: string;
};

const EN: Prompt = {
  labels: {
    cyclists: "cyclist",
    kick_scooters: "kick_scooter",
    mopeds: "electric_moped",
    unicycles: "unicycle",
    pedestrians: "pedestrian",
    cars: "car",
    motorcycles: "motorcycle",
    other: "other",
    discarded: "none",
  },
  instructions: `You classify moving objects seen by a fixed traffic camera (a street with a bike lane, sidewalk and vehicle lanes). It may be day or night; at night there is strong motion blur and headlights.

You receive:
- FILMSTRIP: crops of the SAME object over time (left to right), with a margin above the vehicle to include the rider.
- CONTEXT (if present): the frame at the moment the object crosses the counting line (yellow lines), cropped around it; the colored box marks the object. Some objects were found by motion only: the box may cover just part of it.

Classify ONLY the marked object: the one that appears in every filmstrip crop and inside the context box. Other objects passing nearby (a cyclist next to a car, a pedestrian behind a motorcycle) get their own analysis — ignore them, even if they draw more attention.

Categories:
- cyclist: a person riding a bicycle, sitting on the saddle and pedaling (includes pedal-assist electric bicycles).
- kick_scooter: a person STANDING on a kick scooter, manual or electric (including rental ones): low deck, tall T handlebar, small wheels, no pedaling; the body stays upright and almost still while gliding.
- electric_moped: a person SEATED on a light two-wheeled electric vehicle, not pedaling (small electric scooter/moped, an "electric bicycle" without pedals): smaller and lighter than a motorcycle, small or thin wheels, no exhaust.
- unicycle: a person STANDING on an electric unicycle (a single wheel between the legs, no handlebar; the feet on pedals on both sides of the wheel).
- pedestrian: a person on foot, walking or running.
- motorcycle: a combustion motorcycle, moped or scooter (rider and passenger count as one).
- car: car, van, bus, truck.
- other: something real in motion that is none of the categories above (animal, cart, hand or cargo trolley, wheelchair, skateboard, roller skates, an object blown by the wind, etc.) or that really moves but cannot be identified.
- none: there is no real moving object (shadow, reflection, headlight, rain, a swaying tree, a still object, an empty crop).

Useful hints: at night a blurred cyclist often looks like a "person with no visible legs" moving fast; motorcycles have a strong headlight and a wide body; bicycles have a thin frame and thin wheels, and the cyclist moves their legs; on a kick scooter the person is standing, taller than a cyclist, and the legs do not turn; on a unicycle the person is also standing, but with no handlebar and the arms free. Prefer "other" over "none" when something is really moving. If in doubt between two categories, choose the more likely one and lower the confidence.`,
  filmstrip: "FILMSTRIP:",
  context: "CONTEXT:",
  noFilmstrip: "(no FILMSTRIP: the object is very wide and low; use only the CONTEXT)",
  detectorHint: "The automatic detector (YOLO, may be wrong) suggested: {label}.",
  classify: "Classify the object.",
  reason: "up to 20 words, in English",
};

const PT_BR: Prompt = {
  labels: {
    cyclists: "ciclista",
    kick_scooters: "patinete",
    mopeds: "scooter_eletrico",
    unicycles: "monociclo",
    pedestrians: "pedestre",
    cars: "automovel",
    motorcycles: "motocicleta",
    other: "outro",
    discarded: "nenhum",
  },
  instructions: `Você classifica objetos em movimento vistos por uma câmera fixa de trânsito (rua com ciclovia, calçada e pista de veículos). Pode ser dia ou noite; à noite há borrão de movimento forte e faróis.

Você recebe:
- FILMSTRIP: recortes do MESMO objeto ao longo do tempo (da esquerda para a direita), com uma margem acima do veículo para incluir o condutor.
- CONTEXTO (se houver): o quadro do momento em que o objeto cruza a linha de contagem (linhas amarelas), recortado em volta dele; a caixa colorida marca o objeto. Alguns objetos foram achados só por movimento: a caixa pode cobrir apenas parte dele.

Classifique SOMENTE o objeto marcado: o que aparece em todos os recortes do filmstrip e dentro da caixa do contexto. Outros objetos que passam perto (um ciclista ao lado de um carro, um pedestre atrás de uma moto) têm a sua própria análise — ignore-os, mesmo que chamem mais atenção.

Categorias:
- ciclista: pessoa montada em bicicleta, sentada no selim e pedalando (inclui bicicleta elétrica de pedal).
- patinete: pessoa EM PÉ sobre um patinete, manual ou elétrico (inclusive os de aluguel): plataforma baixa, guidão alto em T, rodas pequenas, sem pedalar; o corpo fica ereto e quase imóvel enquanto desliza.
- scooter_eletrico: pessoa SENTADA num veículo elétrico leve de duas rodas, sem pedalar (motinho/scooter elétrica, "bicicleta elétrica" sem pedal): menor e mais leve que uma moto, rodas pequenas ou finas, sem escapamento.
- monociclo: pessoa EM PÉ sobre um monociclo elétrico (uma única roda entre as pernas, sem guidão; os pés em pedais dos dois lados da roda).
- pedestre: pessoa a pé, andando ou correndo.
- motocicleta: moto, motoneta ou scooter a combustão (com piloto e garupa contam como uma só).
- automovel: carro, van, ônibus, caminhão.
- outro: algo real em movimento que não é nenhuma das categorias acima (animal, carroça, carrinho de mão ou de carga, cadeira de rodas, skate, patins, objeto levado pelo vento etc.) ou que se move de verdade mas não dá para identificar.
- nenhum: não há objeto real em movimento (sombra, reflexo, farol, chuva, árvore balançando, objeto parado, recorte vazio).

Pistas úteis: à noite um ciclista borrado costuma parecer "pessoa sem pernas visíveis" se deslocando rápido; motos têm farol forte e corpo largo; bicicletas têm quadro fino e rodas finas, e o ciclista mexe as pernas; no patinete a pessoa vai em pé, mais alta que um ciclista, e as pernas não giram; no monociclo também vai em pé, mas sem guidão e com os braços soltos. Prefira "outro" a "nenhum" quando houver algo de fato se deslocando. Na dúvida entre duas categorias, escolha a mais provável e reduza a confiança.`,
  filmstrip: "FILMSTRIP:",
  context: "CONTEXTO:",
  noFilmstrip: "(sem FILMSTRIP: o objeto é muito largo e baixo; use só o CONTEXTO)",
  detectorHint: "O detector automático (YOLO, pode errar) sugeriu: {label}.",
  classify: "Classifique o objeto.",
  reason: "até 20 palavras, em português",
};

const ES: Prompt = {
  labels: {
    cyclists: "ciclista",
    kick_scooters: "patinete",
    mopeds: "ciclomotor_electrico",
    unicycles: "monociclo",
    pedestrians: "peaton",
    cars: "automovil",
    motorcycles: "motocicleta",
    other: "otro",
    discarded: "ninguno",
  },
  instructions: `Clasificas objetos en movimiento vistos por una cámara de tráfico fija (una calle con ciclovía, acera y carriles para vehículos). Puede ser de día o de noche; de noche hay un fuerte desenfoque de movimiento y faros.

Recibes:
- FILMSTRIP: recortes del MISMO objeto a lo largo del tiempo (de izquierda a derecha), con un margen por encima del vehículo para incluir al conductor.
- CONTEXTO (si lo hay): el fotograma del momento en que el objeto cruza la línea de conteo (líneas amarillas), recortado alrededor de él; el recuadro de color marca el objeto. Algunos objetos se encontraron solo por movimiento: el recuadro puede cubrir solo una parte.

Clasifica SOLO el objeto marcado: el que aparece en todos los recortes del filmstrip y dentro del recuadro del contexto. Otros objetos que pasan cerca (un ciclista al lado de un coche, un peatón detrás de una moto) tienen su propio análisis — ignóralos, aunque llamen más la atención.

Categorías:
- ciclista: persona montada en una bicicleta, sentada en el sillín y pedaleando (incluye bicicletas eléctricas de pedaleo asistido).
- patinete: persona DE PIE sobre un patinete, manual o eléctrico (incluidos los de alquiler): plataforma baja, manillar alto en T, ruedas pequeñas, sin pedalear; el cuerpo va erguido y casi inmóvil mientras se desliza.
- ciclomotor_electrico: persona SENTADA en un vehículo eléctrico ligero de dos ruedas, sin pedalear (motito o scooter eléctrico, "bicicleta eléctrica" sin pedales): más pequeño y ligero que una moto, ruedas pequeñas o finas, sin tubo de escape.
- monociclo: persona DE PIE sobre un monociclo eléctrico (una sola rueda entre las piernas, sin manillar; los pies en pedales a ambos lados de la rueda).
- peaton: persona a pie, caminando o corriendo.
- motocicleta: moto, motoneta o scooter de combustión (con conductor y acompañante cuentan como una sola).
- automovil: coche, furgoneta, autobús, camión.
- otro: algo real en movimiento que no es ninguna de las categorías anteriores (animal, carreta, carretilla o carro de carga, silla de ruedas, monopatín, patines, un objeto llevado por el viento, etc.) o que se mueve de verdad pero no se puede identificar.
- ninguno: no hay ningún objeto real en movimiento (sombra, reflejo, faro, lluvia, un árbol que se balancea, un objeto quieto, un recorte vacío).

Pistas útiles: de noche un ciclista desenfocado suele parecer una "persona sin piernas visibles" que se desplaza rápido; las motos tienen un faro fuerte y un cuerpo ancho; las bicicletas tienen un cuadro fino y ruedas finas, y el ciclista mueve las piernas; en el patinete la persona va de pie, más alta que un ciclista, y las piernas no giran; en el monociclo también va de pie, pero sin manillar y con los brazos sueltos. Prefiere "otro" a "ninguno" cuando algo se desplaza de verdad. Si dudas entre dos categorías, elige la más probable y reduce la confianza.`,
  filmstrip: "FILMSTRIP:",
  context: "CONTEXTO:",
  noFilmstrip: "(sin FILMSTRIP: el objeto es muy ancho y bajo; usa solo el CONTEXTO)",
  detectorHint: "El detector automático (YOLO, puede equivocarse) sugirió: {label}.",
  classify: "Clasifica el objeto.",
  reason: "hasta 20 palabras, en español",
};

const FR: Prompt = {
  labels: {
    cyclists: "cycliste",
    kick_scooters: "trottinette",
    mopeds: "scooter_electrique",
    unicycles: "monoroue",
    pedestrians: "pieton",
    cars: "automobile",
    motorcycles: "moto",
    other: "autre",
    discarded: "aucun",
  },
  instructions: `Tu classes des objets en mouvement vus par une caméra de circulation fixe (une rue avec piste cyclable, trottoir et voies pour les véhicules). Il peut faire jour ou nuit ; la nuit, il y a un fort flou de mouvement et des phares.

Tu reçois :
- FILMSTRIP : des recadrages du MÊME objet au fil du temps (de gauche à droite), avec une marge au-dessus du véhicule pour inclure le conducteur.
- CONTEXTE (s'il y en a un) : l'image du moment où l'objet franchit la ligne de comptage (lignes jaunes), recadrée autour de lui ; le cadre coloré marque l'objet. Certains objets ont été trouvés uniquement par le mouvement : le cadre peut n'en couvrir qu'une partie.

Classe UNIQUEMENT l'objet marqué : celui qui apparaît dans tous les recadrages du filmstrip et dans le cadre du contexte. Les autres objets qui passent à proximité (un cycliste à côté d'une voiture, un piéton derrière une moto) ont leur propre analyse — ignore-les, même s'ils attirent davantage l'attention.

Catégories :
- cycliste : une personne à vélo, assise sur la selle et pédalant (y compris les vélos à assistance électrique).
- trottinette : une personne DEBOUT sur une trottinette, manuelle ou électrique (y compris celles en libre-service) : plateau bas, haut guidon en T, petites roues, sans pédaler ; le corps reste droit et presque immobile pendant qu'il glisse.
- scooter_electrique : une personne ASSISE sur un véhicule électrique léger à deux roues, sans pédaler (petit scooter électrique, « vélo électrique » sans pédales) : plus petit et plus léger qu'une moto, roues petites ou fines, sans pot d'échappement.
- monoroue : une personne DEBOUT sur une monoroue électrique (une seule roue entre les jambes, sans guidon ; les pieds sur des repose-pieds de chaque côté de la roue).
- pieton : une personne à pied, qui marche ou qui court.
- moto : moto, cyclomoteur ou scooter thermique (conducteur et passager comptent pour un seul).
- automobile : voiture, camionnette, bus, camion.
- autre : quelque chose de réel en mouvement qui n'appartient à aucune des catégories ci-dessus (animal, charrette, diable ou chariot de charge, fauteuil roulant, skateboard, patins, objet emporté par le vent, etc.) ou qui bouge réellement mais ne peut pas être identifié.
- aucun : il n'y a aucun objet réel en mouvement (ombre, reflet, phare, pluie, arbre qui se balance, objet immobile, recadrage vide).

Indices utiles : la nuit, un cycliste flou ressemble souvent à une « personne sans jambes visibles » qui se déplace vite ; les motos ont un phare puissant et un corps large ; les vélos ont un cadre fin et des roues fines, et le cycliste bouge les jambes ; sur une trottinette la personne est debout, plus grande qu'un cycliste, et les jambes ne tournent pas ; sur une monoroue elle est aussi debout, mais sans guidon et les bras libres. Préfère « autre » à « aucun » quand quelque chose se déplace réellement. En cas de doute entre deux catégories, choisis la plus probable et baisse la confiance.`,
  filmstrip: "FILMSTRIP :",
  context: "CONTEXTE :",
  noFilmstrip: "(pas de FILMSTRIP : l'objet est très large et bas ; utilise uniquement le CONTEXTE)",
  detectorHint: "Le détecteur automatique (YOLO, il peut se tromper) a suggéré : {label}.",
  classify: "Classe l'objet.",
  reason: "jusqu'à 20 mots, en français",
};

const DE: Prompt = {
  labels: {
    cyclists: "radfahrer",
    kick_scooters: "tretroller",
    mopeds: "elektroroller",
    unicycles: "einrad",
    pedestrians: "fussgaenger",
    cars: "auto",
    motorcycles: "motorrad",
    other: "sonstiges",
    discarded: "nichts",
  },
  instructions: `Du klassifizierst bewegte Objekte, die eine feste Verkehrskamera sieht (eine Straße mit Radweg, Gehweg und Fahrspuren). Es kann Tag oder Nacht sein; nachts gibt es starke Bewegungsunschärfe und Scheinwerfer.

Du erhältst:
- FILMSTRIP: Ausschnitte DESSELBEN Objekts im Zeitverlauf (von links nach rechts), mit einem Rand über dem Fahrzeug, damit die fahrende Person zu sehen ist.
- KONTEXT (falls vorhanden): das Bild des Moments, in dem das Objekt die Zähllinie (gelbe Linien) überquert, um das Objekt herum zugeschnitten; der farbige Rahmen markiert das Objekt. Manche Objekte wurden nur über Bewegung gefunden: Der Rahmen kann nur einen Teil davon abdecken.

Klassifiziere NUR das markierte Objekt: das, das in allen Ausschnitten des Filmstrips und im Rahmen des Kontexts erscheint. Andere Objekte in der Nähe (ein Radfahrer neben einem Auto, ein Fußgänger hinter einem Motorrad) werden separat analysiert — ignoriere sie, auch wenn sie mehr Aufmerksamkeit auf sich ziehen.

Kategorien:
- radfahrer: eine Person auf einem Fahrrad, die auf dem Sattel sitzt und in die Pedale tritt (einschließlich Pedelecs).
- tretroller: eine Person, die auf einem Tretroller STEHT, manuell oder elektrisch (auch Leihroller): niedriges Trittbrett, hoher T-Lenker, kleine Räder, kein Treten; der Körper bleibt beim Gleiten aufrecht und fast unbewegt.
- elektroroller: eine Person, die auf einem leichten zweirädrigen Elektrofahrzeug SITZT, ohne zu treten (kleiner Elektroroller/E-Moped, ein „E-Bike“ ohne Pedale): kleiner und leichter als ein Motorrad, kleine oder schmale Räder, kein Auspuff.
- einrad: eine Person, die auf einem elektrischen Einrad STEHT (ein einziges Rad zwischen den Beinen, kein Lenker; die Füße auf Trittflächen zu beiden Seiten des Rades).
- fussgaenger: eine Person zu Fuß, gehend oder laufend.
- motorrad: Motorrad, Moped oder Motorroller mit Verbrennungsmotor (fahrende Person und Sozius zählen als eins).
- auto: Auto, Transporter, Bus, Lkw.
- sonstiges: etwas tatsächlich Bewegtes, das in keine der obigen Kategorien passt (Tier, Fuhrwerk, Sack- oder Lastenkarre, Rollstuhl, Skateboard, Rollschuhe, ein vom Wind getragenes Objekt usw.) oder das sich wirklich bewegt, aber nicht zu erkennen ist.
- nichts: es gibt kein echtes bewegtes Objekt (Schatten, Spiegelung, Scheinwerfer, Regen, ein schwankender Baum, ein stillstehendes Objekt, ein leerer Ausschnitt).

Nützliche Hinweise: Nachts wirkt ein unscharfer Radfahrer oft wie eine „Person ohne sichtbare Beine“, die sich schnell bewegt; Motorräder haben einen starken Scheinwerfer und einen breiten Körper; Fahrräder haben einen dünnen Rahmen und dünne Räder, und der Radfahrer bewegt die Beine; auf dem Tretroller steht die Person, ist größer als ein Radfahrer, und die Beine drehen sich nicht; auf dem Einrad steht sie ebenfalls, aber ohne Lenker und mit freien Armen. Wähle lieber „sonstiges“ als „nichts“, wenn sich tatsächlich etwas bewegt. Bist du zwischen zwei Kategorien unsicher, wähle die wahrscheinlichere und senke die Konfidenz.`,
  filmstrip: "FILMSTRIP:",
  context: "KONTEXT:",
  noFilmstrip: "(kein FILMSTRIP: das Objekt ist sehr breit und flach; nutze nur den KONTEXT)",
  detectorHint: "Der automatische Detektor (YOLO, kann sich irren) schlug vor: {label}.",
  classify: "Klassifiziere das Objekt.",
  reason: "bis zu 20 Wörter, auf Deutsch",
};

const NL: Prompt = {
  labels: {
    cyclists: "fietser",
    kick_scooters: "step",
    mopeds: "elektrische_scooter",
    unicycles: "eenwieler",
    pedestrians: "voetganger",
    cars: "auto",
    motorcycles: "motorfiets",
    other: "overig",
    discarded: "niets",
  },
  instructions: `Je classificeert bewegende objecten die een vaste verkeerscamera ziet (een straat met fietspad, stoep en rijstroken). Het kan dag of nacht zijn; 's nachts is er sterke bewegingsonscherpte en zijn er koplampen.

Je krijgt:
- FILMSTRIP: uitsneden van HETZELFDE object in de tijd (van links naar rechts), met een marge boven het voertuig zodat de bestuurder te zien is.
- CONTEXT (indien aanwezig): het beeld van het moment waarop het object de tellijn (gele lijnen) passeert, uitgesneden rond het object; het gekleurde kader markeert het object. Sommige objecten zijn alleen via beweging gevonden: het kader kan slechts een deel ervan bedekken.

Classificeer ALLEEN het gemarkeerde object: het object dat in alle uitsneden van de filmstrip en binnen het kader van de context staat. Andere objecten die dichtbij passeren (een fietser naast een auto, een voetganger achter een motor) worden apart geanalyseerd — negeer ze, ook als ze meer opvallen.

Categorieën:
- fietser: een persoon op een fiets, zittend op het zadel en trappend (inclusief elektrische fietsen met trapondersteuning).
- step: een persoon die STAAT op een step, met de hand aangedreven of elektrisch (ook deelsteps): laag plankje, hoog T-stuur, kleine wielen, geen trappen; het lichaam blijft rechtop en bijna stil tijdens het glijden.
- elektrische_scooter: een persoon die ZIT op een licht elektrisch tweewielig voertuig, zonder te trappen (kleine elektrische scooter, een "elektrische fiets" zonder pedalen): kleiner en lichter dan een motor, kleine of smalle wielen, geen uitlaat.
- eenwieler: een persoon die STAAT op een elektrische eenwieler (één wiel tussen de benen, geen stuur; de voeten op treeplanken aan beide kanten van het wiel).
- voetganger: een persoon te voet, lopend of rennend.
- motorfiets: motor, bromfiets of scooter met verbrandingsmotor (bestuurder en passagier tellen als één).
- auto: auto, busje, bus, vrachtwagen.
- overig: iets echts dat beweegt en in geen van de bovenstaande categorieën past (dier, kar, steek- of bolderkar, rolstoel, skateboard, rolschaatsen, een door de wind meegevoerd voorwerp enz.) of dat echt beweegt maar niet te herkennen is.
- niets: er is geen echt bewegend object (schaduw, weerspiegeling, koplamp, regen, een wiegende boom, een stilstaand object, een lege uitsnede).

Nuttige aanwijzingen: 's nachts lijkt een onscherpe fietser vaak een "persoon zonder zichtbare benen" die snel beweegt; motoren hebben een felle koplamp en een breed lichaam; fietsen hebben een dun frame en dunne wielen, en de fietser beweegt de benen; op een step staat de persoon, is hij groter dan een fietser en draaien de benen niet; op een eenwieler staat de persoon ook, maar zonder stuur en met vrije armen. Kies liever "overig" dan "niets" als er echt iets beweegt. Twijfel je tussen twee categorieën, kies dan de meest waarschijnlijke en verlaag de betrouwbaarheid.`,
  filmstrip: "FILMSTRIP:",
  context: "CONTEXT:",
  noFilmstrip: "(geen FILMSTRIP: het object is erg breed en laag; gebruik alleen de CONTEXT)",
  detectorHint: "De automatische detector (YOLO, kan zich vergissen) stelde voor: {label}.",
  classify: "Classificeer het object.",
  reason: "maximaal 20 woorden, in het Nederlands",
};

const IT: Prompt = {
  labels: {
    cyclists: "ciclista",
    kick_scooters: "monopattino",
    mopeds: "scooter_elettrico",
    unicycles: "monociclo",
    pedestrians: "pedone",
    cars: "automobile",
    motorcycles: "motocicletta",
    other: "altro",
    discarded: "nessuno",
  },
  instructions: `Classifichi oggetti in movimento visti da una telecamera del traffico fissa (una strada con pista ciclabile, marciapiede e corsie per i veicoli). Può essere giorno o notte; di notte c'è un forte mosso e ci sono i fari.

Ricevi:
- FILMSTRIP: ritagli dello STESSO oggetto nel tempo (da sinistra a destra), con un margine sopra il veicolo per includere chi lo guida.
- CONTESTO (se presente): il fotogramma del momento in cui l'oggetto attraversa la linea di conteggio (linee gialle), ritagliato attorno a esso; il riquadro colorato indica l'oggetto. Alcuni oggetti sono stati trovati solo dal movimento: il riquadro può coprirne solo una parte.

Classifica SOLO l'oggetto indicato: quello che compare in tutti i ritagli del filmstrip e dentro il riquadro del contesto. Gli altri oggetti che passano vicino (un ciclista accanto a un'auto, un pedone dietro una moto) hanno una loro analisi — ignorali, anche se attirano di più l'attenzione.

Categorie:
- ciclista: una persona in bicicletta, seduta sul sellino che pedala (comprese le bici elettriche a pedalata assistita).
- monopattino: una persona IN PIEDI su un monopattino, manuale o elettrico (compresi quelli in sharing): pedana bassa, manubrio alto a T, ruote piccole, senza pedalare; il corpo resta eretto e quasi fermo mentre scivola.
- scooter_elettrico: una persona SEDUTA su un veicolo elettrico leggero a due ruote, senza pedalare (piccolo scooter elettrico, "bici elettrica" senza pedali): più piccolo e leggero di una moto, ruote piccole o sottili, senza marmitta.
- monociclo: una persona IN PIEDI su un monociclo elettrico (un'unica ruota tra le gambe, senza manubrio; i piedi su pedane ai due lati della ruota).
- pedone: una persona a piedi, che cammina o corre.
- motocicletta: moto, ciclomotore o scooter a combustione (conducente e passeggero contano come uno).
- automobile: auto, furgone, autobus, camion.
- altro: qualcosa di reale in movimento che non rientra in nessuna delle categorie sopra (animale, carretto, carrello a mano o da carico, sedia a rotelle, skateboard, pattini, un oggetto portato dal vento ecc.) o che si muove davvero ma non si riesce a identificare.
- nessuno: non c'è alcun oggetto reale in movimento (ombra, riflesso, faro, pioggia, un albero che ondeggia, un oggetto fermo, un ritaglio vuoto).

Indizi utili: di notte un ciclista mosso spesso sembra una "persona senza gambe visibili" che si sposta veloce; le moto hanno un faro potente e un corpo largo; le bici hanno un telaio sottile e ruote sottili, e il ciclista muove le gambe; sul monopattino la persona è in piedi, più alta di un ciclista, e le gambe non girano; sul monociclo è anch'essa in piedi, ma senza manubrio e con le braccia libere. Preferisci "altro" a "nessuno" quando qualcosa si sposta davvero. Se sei indeciso tra due categorie, scegli la più probabile e abbassa la confidenza.`,
  filmstrip: "FILMSTRIP:",
  context: "CONTESTO:",
  noFilmstrip: "(nessun FILMSTRIP: l'oggetto è molto largo e basso; usa solo il CONTESTO)",
  detectorHint: "Il rilevatore automatico (YOLO, può sbagliare) ha suggerito: {label}.",
  classify: "Classifica l'oggetto.",
  reason: "fino a 20 parole, in italiano",
};

const DA: Prompt = {
  labels: {
    cyclists: "cyklist",
    kick_scooters: "loebehjul",
    mopeds: "el_knallert",
    unicycles: "ethjulet",
    pedestrians: "fodgaenger",
    cars: "bil",
    motorcycles: "motorcykel",
    other: "andet",
    discarded: "intet",
  },
  instructions: `Du klassificerer objekter i bevægelse set af et fast trafikkamera (en gade med cykelsti, fortov og kørebaner). Det kan være dag eller nat; om natten er der kraftig bevægelsessløring og forlygter.

Du får:
- FILMSTRIP: udsnit af DET SAMME objekt over tid (fra venstre mod højre), med en margen over køretøjet, så føreren kommer med.
- KONTEKST (hvis den findes): billedet fra det øjeblik, hvor objektet krydser tællelinjen (gule linjer), beskåret omkring det; den farvede ramme markerer objektet. Nogle objekter blev kun fundet via bevægelse: rammen kan dække kun en del af dem.

Klassificer KUN det markerede objekt: det, der ses i alle udsnit i filmstrippen og inden for rammen i konteksten. Andre objekter, der passerer tæt på (en cyklist ved siden af en bil, en fodgænger bag en motorcykel), analyseres for sig — ignorer dem, også selvom de tiltrækker mere opmærksomhed.

Kategorier:
- cyklist: en person på en cykel, der sidder på sadlen og træder i pedalerne (inklusive elcykler med pedalassistance).
- loebehjul: en person, der STÅR på et løbehjul, manuelt eller elektrisk (også deleløbehjul): lav platform, højt T-styr, små hjul, ingen pedaler; kroppen holdes oprejst og næsten stille, mens den glider.
- el_knallert: en person, der SIDDER på et let elektrisk tohjulet køretøj uden at træde (lille el-scooter/el-knallert, en "elcykel" uden pedaler): mindre og lettere end en motorcykel, små eller smalle hjul, ingen udstødning.
- ethjulet: en person, der STÅR på en elektrisk ethjulet (ét enkelt hjul mellem benene, intet styr; fødderne på trædeflader på begge sider af hjulet).
- fodgaenger: en person til fods, der går eller løber.
- motorcykel: motorcykel, knallert eller scooter med forbrændingsmotor (fører og passager tæller som én).
- bil: bil, varevogn, bus, lastbil.
- andet: noget virkeligt i bevægelse, som ikke hører til nogen af kategorierne ovenfor (dyr, vogn, sækkevogn eller lastvogn, kørestol, skateboard, rulleskøjter, en genstand båret af vinden osv.), eller som virkelig bevæger sig, men ikke kan identificeres.
- intet: der er intet virkeligt objekt i bevægelse (skygge, refleks, forlygte, regn, et træ der svajer, et stillestående objekt, et tomt udsnit).

Nyttige tips: om natten ligner en sløret cyklist ofte en "person uden synlige ben", der bevæger sig hurtigt; motorcykler har en kraftig forlygte og en bred krop; cykler har et tyndt stel og tynde hjul, og cyklisten bevæger benene; på et løbehjul står personen, er højere end en cyklist, og benene drejer ikke rundt; på en ethjulet står personen også, men uden styr og med frie arme. Vælg hellere "andet" end "intet", når noget faktisk bevæger sig. Er du i tvivl mellem to kategorier, så vælg den mest sandsynlige og sænk konfidensen.`,
  filmstrip: "FILMSTRIP:",
  context: "KONTEKST:",
  noFilmstrip: "(ingen FILMSTRIP: objektet er meget bredt og lavt; brug kun KONTEKSTEN)",
  detectorHint: "Den automatiske detektor (YOLO, kan tage fejl) foreslog: {label}.",
  classify: "Klassificer objektet.",
  reason: "op til 20 ord, på dansk",
};

export const PROMPTS: Record<Locale, Prompt> = { en: EN, "pt-BR": PT_BR, es: ES, fr: FR, de: DE, nl: NL, it: IT, da: DA };
