# Paiements

Activer les prestataires avec `PAYMENT_PROVIDERS=fedapay,kkiapay`. Le démarrage échoue si leurs clés manquent. `mock` est réservé au développement et aux tests : il est refusé en production.

## FedaPay

Variables : `FEDAPAY_SECRET_KEY`, `FEDAPAY_ENV` (`sandbox` ou `live`), `FEDAPAY_WEBHOOK_SECRET`.

Dans le tableau de bord FedaPay, créer un webhook vers `https://<domaine>/api/webhooks/fedapay` (ou `https://<api>/webhooks/fedapay` si l'API est exposée directement) pour les événements `transaction.approved`, `transaction.declined` et `transaction.canceled`. La signature `X-FEDAPAY-SIGNATURE` (`t=…,s=…`, HMAC SHA-256) est vérifiée, puis la transaction est relue via l'API FedaPay.

## KKiaPay

Documentation : https://kkiapay.me/documentation/

Variables : `KKIAPAY_PUBLIC_KEY`, `KKIAPAY_PRIVATE_KEY`, `KKIAPAY_SECRET`, `KKIAPAY_SANDBOX` (`false` en production), `KKIAPAY_WEBHOOK_SECRET`.

Le widget KKiaPay s'ouvre dans le navigateur avec la clé publique ; à la fin il renvoie un `transactionId` que l'API vérifie côté serveur avec les trois clés (montant et `partnerId` = identifiant du paiement). Le webhook `https://<domaine>/api/webhooks/kkiapay` n'est qu'un déclencheur : il est accepté si l'en-tête `KKIAPAY_WEBHOOK_HEADER` (par défaut `x-kkiapay-secret`) contient `KKIAPAY_WEBHOOK_SECRET`, puis la transaction est toujours re-vérifiée.

> À confirmer avec KKiaPay avant la mise en production : le nom exact de l'en-tête qui porte le secret du webhook dans votre compte. Si besoin, ajuster `KKIAPAY_WEBHOOK_HEADER`. Le règlement reste sûr dans tous les cas, car il repose sur la vérification serveur et non sur le webhook.

## Tester sans prestataire

Avec `PAYMENT_PROVIDERS=mock`, le bouton d'abonnement simule un paiement réussi. Les adaptateurs FedaPay et KKiaPay sont testés contre de faux serveurs (`packages/billing/test`).
