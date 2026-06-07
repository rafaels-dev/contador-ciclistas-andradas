"""
Configurações para o contador de veículos e pedestres — Andradas.
Câmera CAM 4 Intelbras, 1920x1080 @ 15fps, visão lateral.
"""

# Modelo YOLOv8 (baixado automaticamente na primeira execução)
MODELO = "yolov8n.pt"

# Posição X da linha de contagem (vertical, centro do frame 1920px)
LINHA_X = 960
LINHA_Y_INICIO = 0      # topo do frame
LINHA_Y_FIM = 1080      # base do frame

# Região de interesse vertical: cobre todo o frame
ROI_Y_MIN = 0
ROI_Y_MAX = 1080

# Detecção
CONFIANCA = 0.40
IOU = 0.50

# Distância máxima person ↔ bicycle para confirmar ciclista (pixels)
# Pessoas fora desse raio de qualquer bicicleta são classificadas como pedestres
DIST_MAX_CYCLIST_PX = 250

# Classes COCO por categoria
# 0=person, 1=bicycle, 2=car, 3=motorcycle, 5=bus, 7=truck
CLASSES_CICLISTAS    = [0, 1]      # person próxima de bicycle
CLASSES_PEDESTRES    = [0]         # person sem bicycle próxima
CLASSES_AUTOMOVEIS   = [2, 5, 7]   # car, bus, truck
CLASSES_MOTOCICLETAS = [3]         # motorcycle
