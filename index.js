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
//BUSCA CATALOGOS DE DORAMAS COM EPISODIOS ORDENADOS PELO NUMERO
app.get('/api/dramas', async (req, res) => {
  try {
    // Usamos 'episodes!left' para evitar erros caso um dorama não tenha episódios
    const { data: dramas, error } = await supabase
      .from('dramas')
      .select(`
        id,
        title,
        category,
        cover_image_url,
        description,
        episodes!left (
          id,
          episode_number
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro Supabase:', error.message);
      return res.status(500).json({ error: error.message });
    }

    const formattedDramas = (dramas || []).map(drama => {
      const sortedEpisodes = (drama.episodes || []).sort((a, b) => a.episode_number - b.episode_number);
      const firstEpId = sortedEpisodes.length > 0 ? sortedEpisodes[0].id : null;

      return {
        id: drama.id,
        title: drama.title,
        category: drama.category,
        coverUrl: drama.cover_image_url || '',
        description: drama.description || '',
        firstEpisodeId: firstEpId
      };
    });

    return res.json(formattedDramas);

  } catch (err) {
    console.error('Erro interno:', err.message);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// Rota para buscar os dados/saldo atualizado do utilizador
app.get('/api/users/:id/balance', async (req, res) => {
  const { id } = req.params;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('coin_balance')
      .eq('id', id)
      .maybeSingle();

    if (error || !user) {
      return res.status(404).json({ error: 'Utilizador não encontrado' });
    }

    return res.json({ coinBalance: user.coin_balance });
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
});
// Registra um utilizador anônimo/convidado na primeira abertura do app
app.post('/api/users/register-guest', async (req, res) => {
  const { userId } = req.body;

  try {
    // Verifica se o ID já existe para não sobrescrever
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, coin_balance')
      .eq('id', userId)
      .maybeSingle();

    if (existingUser) {
      return res.json({ success: true, balance: existingUser.coin_balance });
    }

    // Se não existe, cria a nova conta convidado no Supabase
    const { data: newUser, error } = await supabase
      .from('users')
      .insert([{
        id: userId,
        phone_or_email: `guest_${userId.substring(0, 8)}@oneclick.app`,
        password_hash: 'guest_autogenerated',
        coin_balance: 50
      }])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: 'Erro ao registrar convidado', details: error.message });
    }

    return res.json({ success: true, balance: newUser.coin_balance });

  } catch (error) {
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});