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
// REGISTO AUTOMÁTICO DE NOVO UTILIZADOR/CONVIDADO
app.post('/api/users/register-guest', async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'ID do utilizador é obrigatório' });
  }

  try {
    // 1. Verifica se o utilizador já existe no Supabase
    const { data: existingUser } = await supabase
      .from('users')
      .select('coin_balance')
      .eq('id', userId)
      .maybeSingle();

    if (existingUser) {
      return res.json({ coinBalance: existingUser.coin_balance });
    }

    // 2. Se não existir, insere com 50 moedas de bónus
    const { data: newUser, error } = await supabase
      .from('users')
      .insert([{
        id: userId,
        phone_or_email: `guest_${userId.substring(0, 8)}@oneclick.app`,
        password_hash: 'guest_auto',
        coin_balance: 50
      }])
      .select('coin_balance')
      .single();

    if (error) {
      console.error('Erro ao inserir utilizador:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ coinBalance: newUser.coin_balance });

  } catch (err) {
    console.error('Erro no servidor:', err.message);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});
// Rota para buscar os dados/saldo atualizado do utilizador
app.get('/api/users/:userId/balance', async (req, res) => {
  const { userId } = req.params;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('coin_balance')
      .eq('id', userId)
      .maybeSingle();

    if (error || !user) {
      return res.status(404).json({ error: 'Utilizador não encontrado' });
    }

    return res.json({ coinBalance: user.coin_balance || 0 });
  } catch (err) {
    return res.status(500).json({ error: 'Erro ao consultar saldo' });
  }
});
//BUSCA CATALOGOS DE DORAMAS COM EPISODIOS ORDENADOS PELO NUMERO
app.get('/api/dramas', async (req, res) => {
  try {
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
          title,
          episode_number,
          video_url
        )
      `)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    const formattedDramas = (dramas || []).map(drama => {
      // Ordena episódios pelo número do episódio
      const sortedEpisodes = (drama.episodes || []).sort((a, b) => a.episode_number - b.episode_number);
      const firstEp = sortedEpisodes.length > 0 ? sortedEpisodes[0] : null;

      return {
        id: drama.id,
        title: drama.title,
        category: drama.category,
        coverUrl: drama.cover_image_url || '',
        description: drama.description || '',
        firstEpisodeId: firstEp ? firstEp.id : null,
        firstEpisodeNumber: firstEp ? firstEp.episode_number : 1,
        firstEpisodeTitle: firstEp ? firstEp.title : 'Episódio 1'
      };
    });

    return res.json(formattedDramas);
  } catch (err) {
    console.error('Erro ao buscar doramas:', err.message);
    return res.status(500).json({ error: 'Erro interno no servidor' });
  }
});
// Endpoint para desbloquear episódios com verificação detalhada de erros
app.post('/api/episodes/unlock', async (req, res) => {
  const { userId, episodeId } = req.body;

  try {
    // 1. Procura o episódio
    const { data: episode } = await supabase
      .from('episodes')
      .select('id, video_url, is_free, coin_cost')
      .eq('id', episodeId)
      .maybeSingle();

    if (!episode) return res.status(404).json({ success: false, message: 'Episódio não encontrado' });

    // 2. Se for grátis
    if (episode.is_free) {
      return res.json({ unlocked: true, videoUrl: episode.video_url, coinCost: 0 });
    }

    // 3. Se já foi comprado antes
    const { data: unlocked } = await supabase
      .from('unlocked_episodes')
      .select('id')
      .eq('user_id', userId)
      .eq('episode_id', episodeId)
      .maybeSingle();

    if (unlocked) {
      return res.json({ unlocked: true, videoUrl: episode.video_url, coinCost: episode.coin_cost });
    }

    // 4. Verifica saldo
    const { data: user } = await supabase
      .from('users')
      .select('coin_balance')
      .eq('id', userId)
      .maybeSingle();

    if (!user) return res.status(404).json({ success: false, message: 'Utilizador não encontrado' });

    const cost = episode.coin_cost || 10;
    if (user.coin_balance < cost) {
      return res.json({ unlocked: false, videoUrl: null, coinCost: cost, message: 'Saldo insuficiente de moedas!' });
    }

    // 5. Efetua o débito e registra no histórico
    const newBalance = user.coin_balance - cost;
    await supabase.from('users').update({ coin_balance: newBalance }).eq('id', userId);
    await supabase.from('unlocked_episodes').insert([{ user_id: userId, episode_id: episodeId }]);

    return res.json({ unlocked: true, videoUrl: episode.video_url, coinCost: cost, newBalance: newBalance });

  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erro no servidor' });
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});