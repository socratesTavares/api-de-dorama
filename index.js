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

    if (epError || !episode) {
      return res.status(404).json({ error: 'Episódio não encontrado' });
    }

    // 2. Verificar se o episódio JÁ FOI DESBLOQUEADO previamente
    const { data: alreadyUnlocked } = await supabase
      .from('unlocked_episodes')
      .select('*')
      .eq('user_id', userId)
      .eq('episode_id', episodeId)
      .maybeSingle();

    if (alreadyUnlocked) {
      // Já comprou: retorna o vídeo sem cobrar novamente
      return res.json({
        success: true,
        message: 'Episódio já estava desbloqueado!',
        videoUrl: episode.video_url
      });
    }

    // 3. Procurar o Utilizador
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (userError || !user) {
      return res.status(404).json({ error: 'Utilizador não encontrado' });
    }

    // 4. Verificar Saldo
    if (user.coin_balance < episode.coin_cost) {
      return res.status(400).json({ 
        error: 'Saldo insuficiente', 
        requiredCoins: episode.coin_cost,
        currentBalance: user.coin_balance 
      });
    }

    // 5. Descontar Saldo
    const newBalance = user.coin_balance - episode.coin_cost;
    await supabase
      .from('users')
      .update({ coin_balance: newBalance })
      .eq('id', userId);

    // 6. Registrar Desbloqueio
    await supabase
      .from('unlocked_episodes')
      .insert([{ user_id: userId, episode_id: episodeId }]);

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
//descobrir qual é o primeiro episódio (menor episode_number) de cada dorama:
app.get('/api/dramas', async (req, res) => {
  try {
    // Busca os doramas e traz também os episódios ordenados pelo número
    const { data: dramas, error } = await supabase
      .from('dramas')
      .select(`
        id,
        title,
        category,
        cover_image_url,
        description,
        episodes (
          id,
          episode_number
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar doramas:', error.message);
      return res.status(500).json({ error: 'Erro ao buscar catálogo de doramas' });
    }

    // Mapeia para o formato esperado pelo app Java
    const formattedDramas = dramas.map(drama => {
      // Ordena os episódios pelo número e pega o primeiro (Episódio 1)
      const sortedEpisodes = drama.episodes ? drama.episodes.sort((a, b) => a.episode_number - b.episode_number) : [];
      const firstEpId = sortedEpisodes.length > 0 ? sortedEpisodes[0].id : null;

      return {
        id: drama.id,
        title: drama.title,
        category: drama.category,
        coverUrl: drama.cover_image_url, // Mapeia cover_image_url para coverUrl
        firstEpisodeId: firstEpId
      };
    });

    return res.json(formattedDramas);

  } catch (error) {
    console.error('Erro interno:', error.message);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});