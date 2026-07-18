# LibreChat RAG SaaS — Knowledge Base

Ce fork transforme LibreChat en plateforme SaaS de RAG multi-utilisateurs :
une **knowledge base administrée** (upload de documents, ingestion pgvector,
suivi de progression) avec un **contrôle d'accès hybride** (groupes +
exceptions par utilisateur) appliqué **dans la requête vectorielle SQL**,
jamais après coup.

## Démarrage en une commande

Prérequis : Docker et Docker Compose v2.

```bash
cp .env.kb.example .env
docker compose -f docker-compose.kb.yml up -d --build
```

Puis ouvrez <http://localhost:3080>. Le premier build compile le monorepo
(plusieurs minutes) et le service `ollama-init` télécharge le modèle
d'embeddings (`nomic-embed-text`, ~270 Mo) — les premières ingestions
attendent que ce téléchargement soit terminé.

Ce que le compose démarre :

| Service | Rôle |
|---|---|
| `api` | LibreChat buildé depuis ce fork (UI admin `/kb`, worker d'ingestion, outil `kb_search`) |
| `mongodb` | Base principale (utilisateurs, groupes, documents, droits) |
| `vectordb` | PostgreSQL + pgvector (chunks et embeddings, table `kb_chunks`) |
| `ollama` + `ollama-init` | Embeddings locaux par défaut |
| `meilisearch` | Recherche plein-texte des conversations (fonction standard de LibreChat) |

## Premiers pas

1. **Créer le compte admin** — inscrivez-vous sur l'écran d'accueil : le
   **premier compte enregistré est automatiquement ADMIN**. Passez ensuite
   `ALLOW_REGISTRATION=false` dans `.env` (puis
   `docker compose -f docker-compose.kb.yml up -d api`) pour fermer les
   inscriptions publiques.
2. **Renseigner un fournisseur LLM** pour la conversation (`OPENAI_API_KEY`,
   `ANTHROPIC_API_KEY`, …) dans `.env` — les embeddings, eux, tournent déjà
   en local via Ollama.
3. **Alimenter la knowledge base** — rendez-vous sur
   <http://localhost:3080/kb> (visible pour les admins uniquement) :
   - uploadez des documents (PDF, DOCX, TXT, Markdown) avec, si besoin, des
     paramètres de chunking par lot ;
   - suivez l'ingestion en direct (extraction → chunking → embeddings →
     stockage, avec pourcentage de chunks traités) ; relancez un document en
     erreur ou supprimez-le (cascade complète : vecteurs, droits, fichier) ;
   - gérez les droits par document : accès par **groupe**, et **exceptions
     par utilisateur** (autoriser ou révoquer — la révocation l'emporte sur
     l'appartenance aux groupes) ;
   - créez ou invitez des utilisateurs (le lien d'invitation est toujours
     affiché, l'email part en plus si SMTP est configuré). Les groupes se
     gèrent via l'API admin existante (`/api/admin/groups`).
4. **Côté utilisateur** — créez un agent et cochez l'outil
   **« Knowledge Base Search »** dans le sélecteur d'outils, puis partagez
   cet agent. À chaque question, l'outil résout les droits de l'utilisateur
   courant et la recherche vectorielle est restreinte à ses documents dans
   le `WHERE` SQL : deux utilisateurs obtiennent des réponses différentes
   selon leurs accès, et un utilisateur sans droit n'atteint jamais
   PostgreSQL.

## Variables d'environnement principales

| Variable | Défaut | Description |
|---|---|---|
| `KB_ENABLED` | activé par le compose | Migration pgvector au démarrage + worker + outil `kb_search` |
| `KB_EMBEDDINGS_PROVIDER` | `ollama` | `ollama`, ou tout autre valeur = API compatible OpenAI |
| `KB_EMBEDDINGS_MODEL` | `nomic-embed-text` | Modèle d'embeddings |
| `KB_EMBEDDINGS_DIM` | `768` | **Doit correspondre au modèle** — figé à la création de la table |
| `KB_EMBEDDINGS_BASE_URL` | `http://ollama:11434` (compose) | URL du serveur d'embeddings |
| `KB_EMBEDDINGS_API_KEY` | — | Clé pour les fournisseurs compatibles OpenAI |
| `KB_CHUNK_SIZE` / `KB_CHUNK_OVERLAP` | `1000` / `200` | Chunking par défaut (surchargeable à l'upload) |
| `KB_MAX_FILE_SIZE_MB` | `50` | Taille max d'upload (les PDF/DOCX passent aussi par le cap 15 Mo du parser) |
| `KB_WORKER_CONCURRENCY` | `2` | Documents ingérés en parallèle |
| `POSTGRES_DB/USER/PASSWORD` | `librechat_kb` / `kbuser` / `kbpassword` | Identifiants du pgvector du compose |

Le `.env.kb.example` contient l'ensemble commenté, y compris le passage à un
fournisseur d'embeddings compatible OpenAI et la configuration SMTP pour les
invitations.

## Changer de modèle d'embeddings

La dimension des vecteurs est vérifiée au démarrage contre la table
`kb_settings`. Si vous changez `KB_EMBEDDINGS_MODEL`/`KB_EMBEDDINGS_DIM`
après de premières ingestions, l'API refuse de démarrer la KB avec un
message explicite : les anciens vecteurs sont incompatibles. Pour migrer :

```bash
docker compose -f docker-compose.kb.yml exec vectordb \
  psql -U kbuser -d librechat_kb -c 'DROP TABLE kb_chunks; DROP TABLE kb_settings;'
docker compose -f docker-compose.kb.yml restart api
```

puis relancez l'ingestion de chaque document depuis `/kb`.

## Dépannage

- **Les documents restent en « Pending »** : le modèle Ollama est encore en
  téléchargement (`docker compose -f docker-compose.kb.yml logs ollama-init`)
  ou le worker a rencontré une erreur
  (`docker compose -f docker-compose.kb.yml logs api | grep '\[kb\]'`).
- **Document en « Error »** : le message est affiché dans le tableau de
  `/kb` ; corrigez la cause (fichier vide, provider d'embeddings
  inaccessible, dimension incorrecte) puis cliquez **Réessayer**.
- **`/kb` renvoie vers le chat** : le compte connecté n'est pas ADMIN.
- **Repartir de zéro** :
  `docker compose -f docker-compose.kb.yml down -v` (supprime toutes les
  données : Mongo, vecteurs, uploads, modèle Ollama).
