// Express 4 não captura rejeição de Promise em handler async — sem isso, um erro
// de rede (ex: Stripe/Meta fora do ar) sobe como unhandledRejection e derruba o
// processo inteiro, tirando TODOS os tenants do ar por causa de UM request.
// Todo handler async precisa passar por aqui antes de ser montado numa rota.
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
