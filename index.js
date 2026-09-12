require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Rota raiz
app.get('/', (req, res) => {
  res.send('API de Doramas está rodando!');
});

// Endpoint com verificação detalhada de erros
app.post('/api/episodes/unlock', async (req, res) => {
  const { userId, episodeId } = req.body;

  try {
    // 1. Procurar o Episódio
    const { data: episode, error: epError } = await supabase
      .from('episodes')
      .select('*')
      .eq('id', episodeId)
      .maybeSingle();

    if (epError) {
      return res.status(500).json({ error: 'Erro de banco ao procurar episódio', details: epError.message });
    }
    if (!episode) {
      return res.status(404).json({ error: `Episódio não encontrado para o ID: ${episodeId}` });
    }

    // 2. Procurar o Utilizador
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (userError) {
      return res.status(500).json({ error: 'Erro de banco ao procurar utilizador', details: userError.message });
    }
    if (!user) {
      return res.status(404).json({ error: `Utilizador não encontrado para o ID: ${userId}` });
    }

    // 3. Verificar Saldo
    if (user.coin_balance < episode.coin_cost) {
      return res.status(400).json({ 
        error: 'Saldo insuficiente de moedas', 
        requiredCoins: episode.coin_cost,
        currentBalance: user.coin_balance 
      });
    }

    // 4. Executar a transação
    const newBalance = user.coin_balance - episode.coin_cost;

    const { error: updateError } = await supabase
      .from('users')
      .update({ coin_balance: newBalance })
      .eq('id', userId);

    if (updateError) {
      return res.status(500).json({ error: 'Erro ao atualizar saldo', details: updateError.message });
    }

    const { error: unlockError } = await supabase
      .from('unlocked_episodes')
      .insert([{ user_id: userId, episode_id: episodeId }]);

    if (unlockError) {
      return res.status(500).json({ error: 'Erro ao registrar desbloqueio', details: unlockError.message });
    }

    return res.json({ 
      success: true, 
      message: 'Episódio desbloqueado com sucesso!',
      newBalance, 
      videoUrl: episode.video_url 
    });

  } catch (error) {
    return res.status(500).json({ error: 'Erro interno no servidor', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});