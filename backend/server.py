#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
骗子酒馆游戏后端服务器
支持多后端切换配置
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import random
from datetime import datetime

app = Flask(__name__)
CORS(app)

# 游戏状态存储（简单内存存储，生产环境应使用数据库）
games = {}
players = {}

# 卡牌类型
CARD_TYPES = ['K', 'Q', 'J', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10']

class Game:
    def __init__(self, game_id, max_players=4):
        self.game_id = game_id
        self.max_players = max_players
        self.players = []  # 玩家ID列表
        self.status = 'waiting'  # waiting, playing, finished
        self.current_player = 0
        self.pot_cards = []  # 池中的卡牌
        self.deck = []  # 牌堆
        self.player_hands = {}  # 玩家手牌 {player_id: [cards]}
        self.player_chips = {}  # 玩家筹码 {player_id: count}
        self.last_claim = None  # 上次声明 {'player': player_id, 'card_type': card_type, 'count': count}
        self.round = 0
        self.ready_players = set()  # 已准备的玩家集合
        self.winner = None  # 胜利者
        
    def add_player(self, player_id):
        if len(self.players) < self.max_players and player_id not in self.players:
            self.players.append(player_id)
            self.player_chips[player_id] = 10  # 初始筹码
            return True
        return False
    
    def remove_player(self, player_id):
        """移除玩家（玩家离开游戏）"""
        if player_id in self.players:
            self.players.remove(player_id)
            self.player_chips.pop(player_id, None)
            self.player_hands.pop(player_id, None)
            self.ready_players.discard(player_id)
            return True
        return False
    
    def is_empty(self):
        """检查游戏房间是否为空"""
        return len(self.players) == 0
    
    def start_game(self):
        if len(self.players) < 2:
            return False
        
        self.status = 'playing'
        self.round = 1
        self._init_deck()
        self._deal_cards()
        return True
    
    def _init_deck(self):
        """初始化牌堆"""
        self.deck = CARD_TYPES * 4  # 每种牌4张
        random.shuffle(self.deck)
    
    def _deal_cards(self):
        """发牌"""
        self.player_hands = {}
        cards_per_player = len(self.deck) // len(self.players)
        
        for i, player_id in enumerate(self.players):
            start_idx = i * cards_per_player
            end_idx = start_idx + cards_per_player if i < len(self.players) - 1 else len(self.deck)
            self.player_hands[player_id] = self.deck[start_idx:end_idx]
    
    def play_cards(self, player_id, card_indices, claimed_type):
        """玩家出牌"""
        if self.status != 'playing':
            return {'success': False, 'message': '游戏未开始'}
        
        if self.players[self.current_player] != player_id:
            return {'success': False, 'message': '不是你的回合'}
        
        if not card_indices:
            return {'success': False, 'message': '请选择要出的牌'}
        
        # 检查手牌
        hand = self.player_hands.get(player_id, [])
        cards_played = []
        for idx in card_indices:
            if idx < 0 or idx >= len(hand):
                return {'success': False, 'message': '无效的卡牌索引'}
            cards_played.append(hand[idx])
        
        # 移除手牌
        for idx in sorted(card_indices, reverse=True):
            hand.pop(idx)
        
        # 添加到池中
        self.pot_cards.extend(cards_played)
        
        # 记录声明（必须在此之前记录，否则下家无法质疑）
        self.last_claim = {
            'player': player_id,
            'card_type': claimed_type,
            'count': len(cards_played),
            'actual_cards': cards_played
        }
        
        # 检查该玩家手牌是否出完
        player_hand_empty = len(hand) == 0
        
        # 如果该玩家手牌出完，下家自动质疑，然后重新发牌
        if player_hand_empty:
            # 获取下家
            next_player_index = (self.current_player + 1) % len(self.players)
            next_player_id = self.players[next_player_index]
            
            # 执行质疑逻辑
            challenge_result = self._execute_challenge(next_player_id)
            
            # 收集所有牌并重新发牌
            self._collect_all_cards_and_redeal()
            
            return {
                'success': True,
                'message': f'玩家 {player_id} 手牌已出完！{next_player_id} 自动质疑',
                'auto_challenge': True,
                'challenge_result': challenge_result,
                'game_state': self.get_state()
            }
        
        # 正常流程：切换到下一个有手牌的玩家
        self._advance_to_next_player()
        
        return {
            'success': True,
            'message': f'玩家 {player_id} 出了 {len(cards_played)} 张牌，声称是 {claimed_type}',
            'game_state': self.get_state()
        }
    
    def _advance_to_next_player(self):
        """切换到下一个有手牌的玩家"""
        # 先切换到下一个玩家
        self.current_player = (self.current_player + 1) % len(self.players)
        
        # 如果当前玩家没有手牌，继续切换到下一个
        # 注意：正常情况下，玩家手牌出完时会触发 _start_new_round()
        # 所以这个方法主要用于跳过被淘汰的玩家（筹码为0）
        attempts = 0
        while len(self.player_hands.get(self.players[self.current_player], [])) == 0:
            self.current_player = (self.current_player + 1) % len(self.players)
            attempts += 1
            
            # 避免死循环
            if attempts >= len(self.players):
                print(f"警告：无法找到有手牌的玩家")
                break
    
    def _start_new_round(self):
        """开始新一轮（当有玩家手牌出完时）"""
        print(f"游戏 {self.game_id}: 玩家手牌出完，开始新一轮 (第{self.round + 1}轮)")
        
        # 清空所有玩家的手牌
        self.player_hands = {}
        
        # 重新初始化牌堆并发牌
        self._init_deck()
        self._deal_cards()
        
        # 清空池子和上一次声明
        self.pot_cards = []
        self.last_claim = None
        
        # 轮次+1
        self.round += 1
        
        # 重置到第一个玩家
        self.current_player = 0
        
        print(f"新一轮开始！第{self.round}轮")
    
    def challenge(self, player_id):
        """质疑上一个玩家（手动质疑，由前端调用）"""
        if not self.last_claim:
            return {'success': False, 'message': '没有可质疑的出牌'}
        
        if player_id == self.last_claim['player']:
            return {'success': False, 'message': '不能质疑自己'}
        
        # 执行质疑逻辑
        result = self._execute_challenge(player_id)
        
        # 清空池子
        self.pot_cards = []
        self.last_claim = None
        
        # 切换到下一个有手牌的玩家
        self._advance_to_next_player()
        
        # 检查游戏是否结束
        self._check_game_over()
        
        return {
            'success': True,
            'result': result,
            'game_state': self.get_state()
        }
    
    def _execute_challenge(self, player_id):
        """执行质疑逻辑（内部方法，可被自动质疑调用）"""
        # 检查声明是否真实
        actual_cards = self.last_claim['actual_cards']
        claimed_type = self.last_claim['card_type']  # 修复：使用正确的键名 'card_type'
        
        # 判断是否有谎话
        lies = [card for card in actual_cards if card != claimed_type]
        is_lying = len(lies) > 0
        
        result = {
            'challenger': player_id,
            'defender': self.last_claim['player'],
            'is_lying': is_lying,
            'actual_cards': actual_cards,
            'claimed_type': claimed_type  # 返回时使用 'claimed_type' 作为键名（前端期望）
        }
        
        # 处理筹码
        if is_lying:
            # 说谎者受罚
            self.player_chips[self.last_claim['player']] -= 1
            result['message'] = f"质疑成功！{self.last_claim['player']} 在说谎"
        else:
            # 质疑者受罚
            self.player_chips[player_id] -= 1
            result['message'] = f"质疑失败！{self.last_claim['player']} 说的是真话"
        
        return result
    
    def _collect_all_cards_and_redeal(self):
        """收集所有牌并重新发牌（当有玩家手牌出完时）"""
        print(f"游戏 {self.game_id}: 收集所有牌并重新发牌")
        
        # 收集池子中的牌
        all_cards = list(self.pot_cards)
        self.pot_cards = []
        
        # 收集所有玩家手中的牌
        for player_id in self.players:
            if player_id in self.player_hands:
                all_cards.extend(self.player_hands[player_id])
                self.player_hands[player_id] = []
        
        # 重新洗牌
        random.shuffle(all_cards)
        self.deck = all_cards
        
        # 发牌
        self._deal_cards()
        
        # 清空上一次声明
        self.last_claim = None
        
        # 轮次+1
        self.round += 1
        
        # 重置到第一个玩家
        self.current_player = 0
        
        print(f"新一轮开始！第{self.round}轮，共{len(all_cards)}张牌")
    
    def _check_game_over(self):
        """检查游戏是否结束"""
        for player_id, chips in self.player_chips.items():
            if chips <= 0:
                self.status = 'finished'
                # 找到胜利者（筹码最多的玩家）
                self.winner = max(self.player_chips, key=self.player_chips.get)
                return
    
    def get_state(self):
        """获取游戏状态"""
        return {
            'game_id': self.game_id,
            'status': self.status,
            'players': self.players,
            'current_player': self.players[self.current_player] if self.status == 'playing' else None,
            'player_chips': self.player_chips,
            'player_hands_count': {p: len(h) for p, h in self.player_hands.items()},
            'pot_count': len(self.pot_cards),
            'last_claim': self.last_claim,
            'round': self.round,
            'ready_players': list(self.ready_players),
            'winner': self.winner
        }

# API路由

@app.route('/api/game/create', methods=['POST'])
def create_game():
    """创建新游戏"""
    data = request.json
    game_id = data.get('game_id', f'game_{datetime.now().strftime("%Y%m%d%H%M%S")}')
    max_players = data.get('max_players', 4)
    player_id = data.get('player_id', None)  # 可选的创建者ID
    
    if game_id in games:
        return jsonify({'success': False, 'message': '游戏ID已存在'})
    
    game = Game(game_id, max_players)
    games[game_id] = game
    
    # 如果提供了player_id，自动将创建者加入游戏
    if player_id:
        game.add_player(player_id)
    
    return jsonify({
        'success': True,
        'game_id': game_id,
        'player_id': player_id,
        'message': f'游戏 {game_id} 创建成功' + (f'，{player_id} 已自动加入' if player_id else '')
    })

@app.route('/api/game/<game_id>/join', methods=['POST'])
def join_game(game_id):
    """加入游戏"""
    if game_id not in games:
        return jsonify({'success': False, 'message': '游戏不存在'})
    
    data = request.json
    player_id = data.get('player_id')
    
    if not player_id:
        return jsonify({'success': False, 'message': '请提供玩家ID'})
    
    game = games[game_id]
    if game.add_player(player_id):
        return jsonify({
            'success': True,
            'message': f'玩家 {player_id} 加入游戏',
            'game_state': game.get_state()
        })
    else:
        return jsonify({'success': False, 'message': '加入游戏失败'})

@app.route('/api/game/<game_id>/ready', methods=['POST'])
def player_ready(game_id):
    """玩家准备/取消准备"""
    if game_id not in games:
        return jsonify({'success': False, 'message': '游戏不存在'})
    
    data = request.json
    player_id = data.get('player_id')
    ready = data.get('ready', True)  # 默认为准备
    
    game = games[game_id]
    
    if ready:
        game.ready_players.add(player_id)
    else:
        game.ready_players.discard(player_id)
    
    # 检查是否所有玩家都准备了
    all_ready = len(game.ready_players) == len(game.players) and len(game.players) >= 2
    
    if all_ready:
        # 所有玩家都准备了，开始游戏
        game.start_game()
        return jsonify({
            'success': True,
            'message': '所有玩家已准备，游戏开始!',
            'all_ready': True,
            'game_state': game.get_state()
        })
    
    return jsonify({
        'success': True,
        'message': f'玩家 {player_id} {"已准备" if ready else "取消准备"}',
        'all_ready': False,
        'game_state': game.get_state()
    })


@app.route('/api/game/<game_id>/start', methods=['POST'])
def start_game(game_id):
    """开始游戏（保留兼容性）"""
    if game_id not in games:
        return jsonify({'success': False, 'message': '游戏不存在'})
    
    game = games[game_id]
    if game.start_game():
        return jsonify({
            'success': True,
            'message': '游戏开始',
            'game_state': game.get_state()
        })
    else:
        return jsonify({'success': False, 'message': '开始游戏失败，玩家数量不足'})

@app.route('/api/game/<game_id>/play', methods=['POST'])
def play_cards(game_id):
    """出牌"""
    if game_id not in games:
        return jsonify({'success': False, 'message': '游戏不存在'})
    
    data = request.json
    player_id = data.get('player_id')
    card_indices = data.get('card_indices', [])
    claimed_type = data.get('claimed_type')
    
    game = games[game_id]
    result = game.play_cards(player_id, card_indices, claimed_type)
    
    return jsonify(result)

@app.route('/api/game/<game_id>/challenge', methods=['POST'])
def challenge(game_id):
    """质疑"""
    if game_id not in games:
        return jsonify({'success': False, 'message': '游戏不存在'})
    
    data = request.json
    player_id = data.get('player_id')
    
    game = games[game_id]
    result = game.challenge(player_id)
    
    return jsonify(result)

@app.route('/api/game/<game_id>/state', methods=['GET'])
def get_game_state(game_id):
    """获取游戏状态"""
    if game_id not in games:
        return jsonify({'success': False, 'message': '游戏不存在'})
    
    game = games[game_id]
    return jsonify({
        'success': True,
        'game_state': game.get_state()
    })

@app.route('/api/game/<game_id>/hand/<player_id>', methods=['GET'])
def get_player_hand(game_id, player_id):
    """获取玩家手牌"""
    if game_id not in games:
        return jsonify({'success': False, 'message': '游戏不存在'})
    
    game = games[game_id]
    hand = game.player_hands.get(player_id, [])
    
    return jsonify({
        'success': True,
        'hand': hand
    })

@app.route('/api/config', methods=['GET'])
def get_config():
    """获取服务器配置"""
    return jsonify({
        'server_name': '骗子酒馆后端',
        'version': '1.0.0',
        'card_types': CARD_TYPES
    })



@app.route('/api/game/<game_id>/leave', methods=['POST'])
def leave_game(game_id):
    """玩家离开游戏"""
    if game_id not in games:
        return jsonify({'success': False, 'message': '游戏不存在'})
    
    data = request.json
    player_id = data.get('player_id')
    
    if not player_id:
        return jsonify({'success': False, 'message': '请提供玩家ID'})
    
    game = games[game_id]
    
    # 移除玩家
    if game.remove_player(player_id):
        message = f'玩家 {player_id} 已离开游戏'
        
        # 检查游戏是否为空且未开始
        if game.is_empty() and game.status == 'waiting':
            # 自动释放房间
            del games[game_id]
            return jsonify({
                'success': True,
                'message': message + '，房间已自动释放',
                'room_released': True
            })
        
        return jsonify({
            'success': True,
            'message': message,
            'game_state': game.get_state(),
            'room_released': False
        })
    else:
        return jsonify({'success': False, 'message': '玩家不在游戏中'})

@app.route('/api/game/<game_id>/release', methods=['POST'])
def release_game(game_id):
    """释放游戏房间"""
    if game_id not in games:
        return jsonify({'success': False, 'message': '游戏不存在'})
    
    # 删除游戏
    del games[game_id]
    
    return jsonify({
        'success': True,
        'message': f'游戏房间 {game_id} 已释放'
    })


if __name__ == '__main__':
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    print(f"启动服务器在端口 {port}...")
    app.run(host='0.0.0.0', port=port, debug=True)
