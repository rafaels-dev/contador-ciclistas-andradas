# Traffic Counter

[English](README.md) · [Português (Brasil)](README.pt-BR.md) · [Español](README.es.md) · **Français** · [Deutsch](README.de.md) · [Nederlands](README.nl.md) · [Italiano](README.it.md) · [Dansk](README.da.md)

Une application de bureau qui compte les **cyclistes, piétons, automobiles, motos, trottinettes, scooters électriques et monoroues** dans les vidéos de caméras de rue fixes. Une personne vérifie chaque comptage avant le résultat final.

Elle a été créée pour la recherche sur la mobilité urbaine (tout a commencé avec la caméra de la piste cyclable d’Andradas, au Brésil) et fonctionne avec n’importe quelle vidéo d’une caméra qui ne bouge pas. L’application parle anglais, portugais, espagnol, français, allemand, néerlandais, italien et danois. Elle suit la langue de l’ordinateur, et vous pouvez en choisir une autre dans **Paramètres**.

## Comment ça marche

1. **Choisissez la vidéo.** Utilisez un fichier de votre ordinateur ou un lien Google Drive.
2. **Tracez les lignes de comptage.** Elles peuvent avoir n’importe quel angle (piste cyclable, trottoir, voie de circulation), et vous choisissez ce que compte chaque ligne. Sur les vidéos 4K d’une caméra placée en hauteur, délimitez aussi la zone d’analyse.
3. **Détection.** L’application trouve et suit tout ce qui bouge, grâce à la détection d’objets YOLO et à la détection de mouvement. Elle fonctionne sur une carte graphique NVIDIA ou sur le processeur.
4. **Suggestions.** Un modèle de vision, appelé via OpenRouter avec votre propre clé, suggère la catégorie de chaque objet qui a franchi une ligne. Le prompt et les noms des catégories suivent la langue de l’application.
5. **Vérification.** Vous contrôlez chaque objet dans un éditeur avec l’extrait, la vidéo d’origine et une timeline, et vous acceptez ou corrigez la suggestion. Les raccourcis clavier et l’acceptation groupée des cas fiables rendent l’opération rapide.
6. **Vidéo finale.** Vous obtenez un MP4 avec les lignes, les comptages et un panneau des totaux, ainsi qu’un tableur (`events.csv`) et un rapport (`report.json`). Plusieurs vidéos (les heures d’une journée, par exemple) peuvent devenir une seule vidéo finale aux totaux additionnés.

## Télécharger et installer

Téléchargez le programme d’installation de la dernière version depuis les **[Releases](https://github.com/rafaels-dev/contador-ciclistas-andradas/releases/latest)** :

| Système | Fichier |
|---|---|
| Windows 10/11 (64 bits) | `TrafficCounter-Setup-<version>.exe` |
| macOS (puce Apple) | `TrafficCounter-<version>-arm64.dmg` |
| macOS (Intel) | `TrafficCounter-<version>-x64.dmg` |
| Linux | `.AppImage` ou `.deb` |

Le programme d’installation ne demande pas de droits d’administrateur, et l’application se met à jour d’elle-même. Quand une nouvelle version est prête, un bandeau **Redémarrer et mettre à jour** apparaît.

La première fois, un assistant configure quatre choses :

- **Langue.** La langue de l’ordinateur, ou une autre.
- **Carte graphique.** L’application utilise une carte NVIDIA s’il y en a une (beaucoup plus rapide). Vous pouvez choisir le processeur uniquement.
- **Moteur de détection.** L’application télécharge et installe Python et les bibliothèques d’IA : environ 1 Go sans carte NVIDIA, 2,5 Go avec, et jusqu’à ~6 Go sur le disque.
- **Clé OpenRouter.** OpenRouter est le service payé à l’usage qui fait les suggestions. Chaque suggestion coûte une fraction de centime : deux heures de vidéo d’une avenue animée ont coûté environ 0,10 US$. Créez une clé sur [openrouter.ai](https://openrouter.ai/keys) et collez-la dans l’application, qui la teste avant de l’enregistrer.

**Configuration requise :**
- Une carte graphique NVIDIA (facultative, recommandée).
- De l’espace disque pour le moteur (~6 Go) et pour les vidéos finales.
- Internet, pour installer le moteur et pour les suggestions.

**En cas de problème :** allez dans **Paramètres → Aide et diagnostic**, cliquez sur **Enregistrer le rapport de diagnostic**, et envoyez le fichier `.zip` à la personne qui vous assiste. Il contient le journal du programme et ce qui s’est passé pour chaque vidéo. Il ne contient ni les vidéos ni votre clé.

Mise à jour depuis la version 0.0.7 ou antérieure (quand l’application s’appelait « Contador de Tráfego ») : l’application déplace vos données vers le nouveau nom au premier démarrage. Rien n’est détecté à nouveau et aucune vérification n’est perdue.

## Confidentialité

Les vidéos sont traitées **sur votre ordinateur** et ne sont envoyées nulle part. L’application ne communique avec d’autres systèmes que dans ces cas :

| Quand | Vers où | Ce qui est envoyé |
|---|---|---|
| Suggestions de catégorie (avec la clé que vous avez configurée) | [OpenRouter](https://openrouter.ai/privacy) et le fournisseur de modèle vers lequel il route (par défaut : Anthropic ; de secours : DeepSeek et Google) | De petits recadrages de chaque objet candidat (une suite de recadrages et l’image du passage, en JPEG). Rien d’autre de la vidéo. |
| Vous collez un lien Google Drive | [Google Drive](https://policies.google.com/privacy) | La demande de téléchargement du fichier lié. |
| Installation du moteur (premier démarrage ou « Installer maintenant ») | GitHub (Python), [PyPI](https://pypi.org) et download.pytorch.org | Les demandes de téléchargement des bibliothèques. |
| Mises à jour (à l’ouverture de l’application et toutes les 4 h) | Les [GitHub Releases](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) de ce dépôt | Une vérification de la dernière version et, s’il y en a une, son téléchargement. |

Il n’y a ni télémétrie, ni compte utilisateur, ni collecte de données d’utilisation. Le rapport de diagnostic n’est créé que si vous le demandez. Il est enregistré sur votre ordinateur et n’inclut pas la clé OpenRouter.

## Politique de signature du code (Code signing policy)

Les programmes d’installation sont construits par GitHub Actions ([`.github/workflows/desktop.yml`](.github/workflows/desktop.yml)) directement à partir du code de ce dépôt, pour chaque tag `v*`. Une signature de code gratuite pour les projets open source a été demandée à la [SignPath Foundation](https://signpath.org). En attendant, Windows et macOS avertissent au premier démarrage que l’application provient d’un développeur non identifié.

Équipe :

- Committers (commits sans revue supplémentaire) : [Rafael Schettino](https://github.com/rafaels-dev)
- Relecteurs : [Rafael Schettino](https://github.com/rafaels-dev)
- Approbateurs (approuvent chaque signature) : [Rafael Schettino](https://github.com/rafaels-dev)

Toute modification de la branche `main` doit passer les tests automatisés ([`.github/workflows/tests.yml`](.github/workflows/tests.yml)) avant de pouvoir être fusionnée.

Confidentialité : voir la section [Confidentialité](#confidentialité). Ce programme ne transfère aucune information à d’autres systèmes en réseau, sauf demande expresse de l’utilisateur ou de la personne qui l’installe ou l’exploite, à l’exception des cas qui y sont listés.

## Pour les développeurs

Organisation :

- `web/` : l’application (Next.js). Écrans, base de données SQLite, orchestration des étapes et appels à OpenRouter. Les traductions sont dans `web/messages/<language>.json` (next-intl) et les prompts de vision dans `web/src/lib/prompts.ts`.
- `worker/` : Python. Détection et suivi (`detect.py`), vidéo finale (`render.py`), lecture vidéo avec FFmpeg/NVDEC (`reader.py`).
- `desktop/` : Electron et programmes d’installation (electron-builder). Voir [`desktop/README.md`](desktop/README.md).
- `counter/`, `process_video.py`, `stream_realtime.py` : le compteur en ligne de commande d’origine (comptage automatique sur une ligne verticale, sans vérification), conservé pour le traitement par lots et en temps réel.
- `evaluation/` : outils pour évaluer le comptage et calibrer les modèles.
- `tests/`, `web/src/**/*.test.ts` et `web/evals/` : tests automatisés et évaluations des prompts.

Pour lancer l’application en développement, il faut Python 3.11 avec les dépendances et Node.js 22+ :

```bash
python -m venv venv && source venv/bin/activate      # Windows : venv\Scripts\activate
pip install torch==2.12.0 torchvision==0.27.0 --index-url https://download.pytorch.org/whl/cpu   # ou cu126 pour NVIDIA
pip install -r requirements-dev.txt
cd web && npm ci && npm run dev                       # http://127.0.0.1:3000
```

Tests (les mêmes que la CI, obligatoires pour fusionner dans `main`) :

```bash
python -m pytest                      # worker et compteur (à la racine)
cd web && npm run lint && npm run typecheck && npm test
cd web && npm run eval:prompts        # prompt de vision dans toutes les langues (payant ; voir web/evals/README.md)
```

Ajouter une langue : ajoutez un `web/messages/<code>.json` avec toutes les clés de `en.json`, une entrée dans `web/src/i18n/locales.ts`, et le prompt dans `web/src/lib/prompts.ts`. Lancez ensuite les évaluations des prompts.

Compteur en ligne de commande :

```bash
python process_video.py --video camera.mp4                 # vidéo annotée + result.json
python process_video.py --video camera.mp4 --no-video      # chiffres uniquement
python stream_realtime.py rtsp://192.168.1.100/cam4         # événements JSON en temps réel
```

## Licence

Copyright © 2026 Rafael Schettino.

Ce programme est un logiciel libre, distribué sous la **GNU Affero General Public License, version 3** ([`LICENSE`](LICENSE)). Vous pouvez l’utiliser, l’étudier, le modifier et le redistribuer. Si vous distribuez des versions modifiées, ou si vous les proposez à d’autres personnes via un réseau, vous devez rendre le code source disponible sous la même licence.

Principaux composants tiers, tous open source :

| Composant | Licence |
|---|---|
| [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) et les poids `yolov8n.pt` (y compris l’ajustement fin dans `runs/ft_blur`) | AGPL-3.0 |
| [PyTorch](https://pytorch.org) | BSD-3-Clause |
| [OpenCV](https://opencv.org) | Apache-2.0 |
| [supervision](https://github.com/roboflow/supervision) | MIT |
| [FFmpeg](https://ffmpeg.org) (via imageio-ffmpeg) | LGPL/GPL |
| [Electron](https://www.electronjs.org), [Next.js](https://nextjs.org), [next-intl](https://next-intl.dev), [React](https://react.dev) | MIT |
| [uv](https://github.com/astral-sh/uv) | MIT / Apache-2.0 |
