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

// Rota de desbloqueio de episódios
app.post('/api/episodes/unlock', async (req, res) => {
  const { userId, episodeId } = req.body;

  try {
    const { data: episode } = await supabase
      .from('episodes')
      .select('*')
      .eq('id', episodeId)
      .single();

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (!user || !episode) {
      return res.status(404).json({ error: 'Utilizador ou episódio não encontrado' });
    }

    if (user.coin_balance < episode.coin_cost) {
      return res.status(400).json({ 
        error: 'Moedas insuficientes', 
        requiredCoins: episode.coin_cost,
        currentBalance: user.coin_balance 
      });
    }

    const newBalance = user.coin_balance - episode.coin_cost;

    await supabase
      .from('users')
      .update({ coin_balance: newBalance })
      .eq('id', userId);

    await supabase
      .from('unlocked_episodes')
      .insert([{ user_id: userId, episode_id: episodeId }]);

    return res.json({ 
      success: true, 
      newBalance, 
      videoUrl: episode.video_url 
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});